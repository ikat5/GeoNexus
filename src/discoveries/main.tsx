import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import '@/styles/app.css';
import '@/styles/landing.css';
import '@/styles/atlas.css';
import { AtlasPage } from './Atlas';

createRoot(document.getElementById('root')!).render(<MotionConfig reducedMotion="user"><AtlasPage /></MotionConfig>);
