import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import '@/styles/app.css';
import '@/styles/landing.css';
import { Landing } from './Landing';

createRoot(document.getElementById('root')!).render(<MotionConfig reducedMotion="user"><Landing /></MotionConfig>);
