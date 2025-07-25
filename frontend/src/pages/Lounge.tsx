import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CandleFlicker } from '../components/ambient/CandleFlicker';
// Remove direct import of WhisperCard
// import WhisperCard from '../components/whisper/WhisperCard';
const WhisperCard = lazy(() => import('../components/whisper/WhisperCard'));
import { useWhispers } from '../services/api';
import ErrorBoundary from "../components/shared/ErrorBoundary";
import { getErrorMessage } from "../lib/errorUtils";
import { useRef } from "react";
import { DreamHeader } from '../components/shared/DreamHeader';
import { GentlePresenceRibbon } from '../components/shared/PresenceRibbon';

const Listen: React.FC = () => {
  const [currentWhisperIndex, setCurrentWhisperIndex] = useState(0);
  // Remove all UI that uses presenceCount (avatars and poetic line)

  // Fetch 2-3 real whispers from backend
  const { data: realWhispers, isLoading } = useWhispers({ limit: 3 });

  // Fallback ambient whispers
  const ambientWhispers = useMemo(() => ([
    {
      id: "1",
      content: "The quad is so peaceful at night. You can hear your own thoughts.",
      emotion: "calm",
      timestamp: new Date().toISOString(),
    },
    {
      id: "2",
      content: "Sometimes I wish the canteen served chai after 8pm.",
      emotion: "nostalgia",
      timestamp: new Date().toISOString(),
    },
    {
      id: "3",
      content: "The library lights look like stars from the hostel roof.",
      emotion: "hope",
      timestamp: new Date().toISOString(),
    },
  ]), []);

  // Use real whispers if available, else fallback
  const whispersToShow = realWhispers && realWhispers.length > 0 ? realWhispers : ambientWhispers;

  useEffect(() => {
    const whisperCycle = setInterval(() => {
      setCurrentWhisperIndex(prev => (prev + 1) % whispersToShow.length);
    }, 12000); // Cycle every 12 seconds

    return () => clearInterval(whisperCycle);
  }, [whispersToShow.length]);

  const mainRef = useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (mainRef.current) {
      mainRef.current.focus();
    }
  }, []);

  return (
    <ErrorBoundary narratorLine="A gentle hush falls over the campus. Something went adrift in the lounge.">
      <main
        role="main"
        aria-labelledby="page-title"
        tabIndex={-1}
        ref={mainRef}
        className="fixed inset-0 bg-aangan-dusk flex flex-col items-center justify-start p-4 overflow-hidden"
      >
        <h1 id="page-title" className="sr-only">Lounge</h1>
        {/* DreamHeader only in Lounge */}
        <DreamHeader title="Lounge" subtitle="A quiet, real-time space for presence." />
        {/* GentlePresenceRibbon only in Lounge */}
        <GentlePresenceRibbon presenceCount={3} />
        {/* Ambient Presence Avatars & Poetic Line */}
        {/* Removed fake presence avatars and poetic line. If real presence data is available, insert here. */}
        {/* Shimmer while loading */}
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="bg-white/10 rounded-lg p-8 animate-pulse h-32 mb-4" />
              </motion.div>
            ))}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {whispersToShow.length === 0 ? (
              <div className="text-center py-16 space-y-4 animate-pulse">
                <div className="w-20 h-20 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
                  <span className="text-4xl">🪶</span>
                </div>
                <div className="space-y-2">
                  <h3 className="text-white font-medium text-lg">
                    The courtyard is quiet tonight.
                  </h3>
                  <p className="text-purple-100 text-sm max-w-md mx-auto">
                    Listen closely. Even silence has a story.
                  </p>
                  <div className="h-6 w-2/3 mx-auto bg-purple-300/20 rounded animate-pulse" />
                </div>
              </div>
            ) : (
              <Suspense fallback={<div className="bg-white/10 rounded-lg p-8 animate-pulse h-32 mb-4" />}>
                <motion.div
                  key={whispersToShow[currentWhisperIndex].id}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -40 }}
                  transition={{ duration: 2.5, ease: 'easeInOut' }}
                >
                  <WhisperCard whisper={whispersToShow[currentWhisperIndex]} />
                  {/* Ambient particles */}
                  <div className="absolute inset-0 pointer-events-none">
                    {[...Array(20)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="absolute w-1 h-1 bg-white/20 rounded-full"
                        style={{
                          left: `${Math.random() * 100}%`,
                          top: `${Math.random() * 100}%`,
                        }}
                        animate={{
                          y: [-20, -100],
                          opacity: [0, 1, 0],
                          scale: [0, 1, 0]
                        }}
                        transition={{
                          duration: 8 + Math.random() * 4,
                          repeat: Infinity,
                          delay: Math.random() * 5,
                          ease: "easeOut"
                        }}
                      />
                    ))}
                  </div>
                </motion.div>
              </Suspense>
            )}
          </AnimatePresence>
        )}
      </main>
      {/* Gentle instruction (hidden, but Esc still works) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 3, duration: 1 }}
        className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-white/40 text-sm"
      >
        Return to Courtyard
      </motion.div>
    </ErrorBoundary>
  );
};

export default Listen; 