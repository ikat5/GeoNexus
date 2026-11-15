// Build-time render of the landing page (scripts/prerender.mjs), so the HTML carries the real content: crawlers and
// no-JS visitors see it, and the h1 paints before any JavaScript runs. main.tsx hydrates it.
import { renderToString } from 'react-dom/server';
import { MotionConfig } from 'motion/react';
import { Landing } from './Landing';

export const render = () => renderToString(<MotionConfig reducedMotion="user"><Landing /></MotionConfig>);
