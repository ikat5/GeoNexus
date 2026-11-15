// Rover kinematics over a terrain height field, plus an onboard inverse estimator.
// The estimator only sees its own drive-force command, wheel odometry and an along-track IMU accelerometer.
export const ROVER = { m: 900, Cd: 1.1, A: 4, Crr: 0.05, Fmax: 4000, vTarget: 12, L: 3 };
const TAU = 2 * Math.PI;
const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(TAU * Math.random());
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ema = (prev, x, dt, tau) => (prev == null ? x : prev + (x - prev) * Math.min(1, dt / tau));
const wrap = (a) => ((a % TAU) + TAU) % TAU;
const wrapLon = (l) => ((((l + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

// Great-circle step on a sphere: from (lat, lon) along bearing hd by angle s (= distance / radius).
// Returns [lat, lon, bearing on arrival]. Valid everywhere, including across a pole and the ±180° meridian.
export function travel(lat, lon, hd, s) {
  const sl = Math.sin(lat), cl = Math.cos(lat), ss = Math.sin(s), cs = Math.cos(s);
  const lat2 = Math.asin(Math.min(1, Math.max(-1, sl * cs + cl * ss * Math.cos(hd))));
  const lon2 = wrapLon(lon + Math.atan2(Math.sin(hd) * ss * cl, cs - sl * Math.sin(lat2)));
  // forward bearing on arrival = reverse of the initial bearing from the new point back to the old one
  const back = Math.atan2(Math.sin(lon - lon2) * cl, Math.cos(lat2) * sl - Math.sin(lat2) * cl * Math.cos(lon - lon2));
  return [lat2, lon2, wrap(back + Math.PI)];
}

export class Rover {
  // atmosphere(h, lat, lon) -> {T, p, rho}; defaults to the world model, swapped for live weather on Earth
  constructor(world, heightAt, lon, lat, h0, atmosphere = world.atmosphere) {
    Object.assign(this, { world, heightAt, atmosphere, lon, lat, heading: Math.random() * TAU, v: 0, t: 0, F: 0, Fi: 0, pitch: 0, planT: 0, stuck: 0 });
    this.h = this.h0 = heightAt(lon, lat) ?? h0;
    this.targetHeading = this.heading;
    this.truth = atmosphere(this.h, lat, lon);
    // landing altitude is known from descent; everything after is inferred
    this.est = { h: this.h, slope: 0, rho: null, T: null, fx: null, aOdo: null, vPrev: 0, win: 0, sdv: 0, sv4: 0, vacuum: !world.gasR };
  }

  // terrain height d metres from the rover along heading hd
  hAt(hd, d) {
    const R = this.world.radii[0];
    const [lat, lon] = travel(this.lat, this.lon, hd, d / R);
    return this.heightAt(lon, lat) ?? this.h;
  }

  step(dt) {
    const w = this.world, g = w.g, P = ROVER;

    // autonomy: every 1.5 s take the least-steep of five headings 30 m ahead; turn around if stalled
    if ((this.planT -= dt) <= 0) {
      this.planT = 1.5;
      let best = Infinity;
      for (const d of [-0.7, -0.35, 0, 0.35, 0.7]) {
        const cost = Math.abs(this.hAt(this.heading + d, 30) - this.h) / 30 + 0.05 * Math.abs(d) + 0.05 * Math.random();
        if (cost < best) { best = cost; this.targetHeading = wrap(this.heading + d); }
      }
    }
    this.stuck = this.v < 0.3 ? this.stuck + dt : 0;
    if (this.stuck > 3) { this.targetHeading = wrap(this.heading + Math.PI); this.stuck = 0; this.planT = 5; }
    const turn = ((this.targetHeading - this.heading + 3 * Math.PI) % TAU) - Math.PI;
    this.heading = wrap(this.heading + clamp(turn, -0.6 * dt, 0.6 * dt));

    // longitudinal dynamics: PI speed controller vs gravity, rolling resistance and aero drag
    const slope = Math.atan2(this.hAt(this.heading, P.L) - this.hAt(this.heading + Math.PI, P.L), 2 * P.L);
    const atm = this.atmosphere(this.h, this.lat, this.lon);
    const err = P.vTarget - this.v;
    this.Fi = clamp(this.Fi + 0.5 * P.m * err * dt, -P.Fmax, P.Fmax);
    const F = clamp(this.Fi + P.m * err, -P.Fmax, P.Fmax); // negative = braking downhill
    const drag = 0.5 * atm.rho * P.Cd * P.A * this.v ** 2;
    const a = (F - drag) / P.m - g * Math.sin(slope) - P.Crr * g * Math.cos(slope);
    const v0 = this.v;
    this.v = Math.max(0, v0 + a * dt); // brakes hold: no rolling backwards
    const aTrue = (this.v - v0) / dt;
    const ds = 0.5 * (v0 + this.v) * dt * Math.cos(slope);
    // move along the great circle; the compass bearing is carried forward, so crossing a pole turns "north" into
    // "south" without the rover itself turning. The steering target turns by the same amount.
    const [lat2, lon2, hd2] = travel(this.lat, this.lon, this.heading, ds / w.radii[0]);
    this.targetHeading = wrap(this.targetHeading + (hd2 - this.heading));
    Object.assign(this, { lat: lat2, lon: lon2, heading: hd2 });
    this.h = this.heightAt(this.lon, this.lat) ?? this.h;
    Object.assign(this, { F, pitch: slope, truth: atm, t: this.t + dt });

    // onboard inverse estimator (sensors only, no map, no truth)
    const e = this.est;
    const vMeas = this.v + 0.003 * randn();                  // wheel odometry
    const fx = aTrue + g * Math.sin(slope) + 0.005 * randn(); // IMU along-track specific force
    e.aOdo = ema(e.aOdo, (vMeas - e.vPrev) / dt, dt, 0.5); e.vPrev = vMeas;
    e.fx = ema(e.fx, fx, dt, 0.5);
    const sinS = clamp((e.fx - e.aOdo) / g, -1, 1);          // IMU sees gravity, odometry doesn't
    e.slope = Math.asin(sinS);
    e.h += vMeas * dt * sinS;                                 // dead-reckoned elevation (drifts)
    // density: deceleration the drive force can't explain after rolling resistance is aero drag, d = c·ρ·v².
    // 1 s least-squares window -> raw ρ clamped >= 0 -> EMA (α = 0.15 per window), so IMU noise can't swing it
    const c = (P.Cd * P.A) / (2 * P.m), d = F / P.m - P.Crr * g * Math.cos(e.slope) - fx;
    if (vMeas > 8) { e.sdv += d * vMeas ** 2; e.sv4 += vMeas ** 4; } // near cruise: slope estimate has settled, drag is measurable
    if ((e.win += dt) >= 1) {
      if (e.sv4 > 0) { const raw = Math.max(0, e.sdv / (c * e.sv4)); e.rho = e.rho == null ? raw : e.rho + 0.15 * (raw - e.rho); }
      e.win = e.sdv = e.sv4 = 0;
    }
    e.vacuum = !w.gasR || (e.rho != null && e.rho < 0.0005);
    if (e.vacuum) e.T = this.atmosphere(e.h, this.lat, this.lon).T; // airless: solar-incidence thermal model at the dead-reckoned position
    else if (e.rho != null) {
      // ideal gas: barometric pressure at the inferred altitude / (R · inferred density), clamped to planetary bounds
      const [lo, hi] = w.tBounds;
      e.T = ema(e.T, clamp(this.atmosphere(e.h, this.lat, this.lon).p / (w.gasR * e.rho), lo, hi), dt, 4);
    }
  }

  // [true, inferred] pairs for elevation m, slope °, density kg/m³, temperature K
  telemetry() {
    const e = this.est, d = 180 / Math.PI;
    return [[this.h, e.h], [this.pitch * d, e.slope * d], [this.truth.rho, e.vacuum ? 0 : e.rho], [this.truth.T, e.T]];
  }
}
