import { hydrateRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import '@/styles/app.css';
import '@/styles/landing.css';
import { Landing } from './Landing';

// dist/index.html is prerendered (scripts/prerender.mjs); in dev the root is empty and React renders it fresh
hydrateRoot(document.getElementById('root')!, <MotionConfig reducedMotion="user"><Landing /></MotionConfig>);
