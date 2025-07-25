import React, { useState, useEffect, Suspense, lazy, useCallback, useRef, memo } from "react";
import { toast } from "sonner";
import { DreamLayout } from "../components/shared/DreamLayout";
import { DreamHeader, isUserFacingRoute } from "../components/shared/DreamHeader";
import { motion, AnimatePresence } from "framer-motion";
import { useCUJHotspots } from '../contexts/use-cuj-hotspots';
import { useShhhNarrator } from '../contexts/use-shhh-narrator';
import { useWhispers as useWhispersQuery } from '../services/api';
import { PoeticEmotionBanner } from '../components/shared/EmotionPulseBanner';
import { GentlePresenceRibbon } from '../components/shared/PresenceRibbon';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import SoftBack from "../components/shared/SoftBack";
import { X } from "lucide-react";
import { updateEmotionStreak } from "../../lib/streaks";
import { Plus } from "lucide-react";
import { HelpCircle } from 'lucide-react';
import { Ghost } from 'lucide-react';
import { ConfettiEffect } from '../components/shared/ConfettiEffect';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import ErrorBoundary from "../components/shared/ErrorBoundary";
import { getErrorMessage } from "../../lib/errorUtils";
import { Button } from "../components/ui/button";
import type { Whisper as APIWhisper } from "../services/api";
import { WhisperCard } from '../components/whisper/WhisperCard';
import { CustomSkeletonCard } from "../components/ui/skeleton";
import { useErrorBoundaryLogger } from "../hooks/useErrorBoundaryLogger";
import WhisperSkeleton from "../components/whisper/WhisperSkeleton";
import { useLocation } from "react-router-dom";

type Whisper = APIWhisper & {
  guest_id?: string;
  author?: string;
  isActive?: boolean;
};
type WhisperWithAI = Whisper & {
  isAIGenerated?: boolean;
  is_ai_generated?: boolean;
  isGhost?: boolean;
};

type WhisperReply = { id: string; content: string; created_at: string };

// Pulse messages for 'What’s happening now'
const pulseMessages = [
  '✨ Someone just whispered under the Banyan Tree',
  '🌿 A gentle echo drifted through the Library',
  '💬 A reply just landed in the Quad',
  '🌙 Someone found comfort in the Lounge tonight',
  '🔥 A new whisper sparked in the Hostel',
];
const echoMessages = [
  'Someone just echoed a whisper…',
  'A gentle voice replied to a lonely thought…',
  'A heart reacted to a campus secret…',
  'A new echo rippled through the courtyard…',
];

// Add a simple network status indicator component
function NetworkStatus({ isFetching }: { isFetching: boolean }) {
  if (!isFetching) return null;
  return (
    <div className="fixed top-0 left-0 w-full z-50 flex items-center justify-center bg-indigo-100 text-indigo-700 text-sm py-1 animate-pulse shadow">
      Connecting to campus...
    </div>
  );
}

const Whispers: React.FC = () => {
  const { nearbyHotspots, emotionClusters, systemTime, campusActivity } = useCUJHotspots();
  const { narratorState } = useShhhNarrator();
  // Remove context-based whispers
  // const { whispers, setWhispers } = useWhispers();
  const [selectedWhisper, setSelectedWhisper] = useState<Whisper | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [recentWhispers, setRecentWhispers] = useState<Whisper[]>([]);
  const [showRepliesModal, setShowRepliesModal] = useState(false);
  const [activeReplies, setActiveReplies] = useState<WhisperReply[]>([]);
  const [activeWhisper, setActiveWhisper] = useState<string | null>(null);
  const [pulseIndex, setPulseIndex] = useState(0);
  const [echoIndex, setEchoIndex] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  // Pagination state
  const PAGE_SIZE = 20;
  const [offset, setOffset] = useState(0);
  const [allWhispers, setAllWhispers] = useState<Whisper[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Fetch whispers for current page
  const { data: apiWhispers = [], isLoading, error, refetch, isFetching } = useWhispersQuery({ limit: PAGE_SIZE, offset });
  const whispers: Whisper[] = apiWhispers as Whisper[];

  // On initial load or offset change, append new whispers
  useEffect(() => {
    if (whispers && whispers.length > 0) {
      setAllWhispers(prev => {
        // Avoid duplicates by id
        const ids = new Set(prev.map(w => w.id));
        const newOnes = whispers.filter(w => !ids.has(w.id));
        return [...prev, ...newOnes];
      });
      setHasMore(whispers.length === PAGE_SIZE);
    } else if (offset === 0 && whispers.length === 0) {
      setAllWhispers([]);
      setHasMore(false);
    } else if (whispers.length < PAGE_SIZE) {
      setHasMore(false);
    }
    setIsLoadingMore(false);
  }, [whispers, offset]);

  // Load more handler
  const handleLoadMore = useCallback(() => {
    setIsLoadingMore(true);
    setOffset(prev => prev + PAGE_SIZE);
  }, []);

  // Fetch 5 most recent whispers for 'Recently Whispered…' section
  const logError = useErrorBoundaryLogger("HomeFeed");
  useEffect(() => {
    async function fetchRecentWhispers() {
      try {
        const res = await fetch("/api/whispers?limit=5");
        if (res.ok) {
          const data = await res.json();
          setRecentWhispers(data);
        }
      } catch (err) {
        logError(err, { context: "fetchRecentWhispers" });
      }
    }
    fetchRecentWhispers();
  }, []);

  // Show echo encouragement toast after viewing a whisper or after a short delay
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (selectedWhisper) {
      timeout = setTimeout(() => {
        toast(
          "Saw a whisper you felt? Echo to let someone know.",
          { duration: 4000, position: "bottom-center" }
        );
      }, 1200);
    } else {
      timeout = setTimeout(() => {
        toast(
          "Saw a whisper you felt? Echo to let someone know.",
          { duration: 4000, position: "bottom-center" }
        );
      }, 8000);
    }
    return () => clearTimeout(timeout);
  }, [selectedWhisper]);

  // Helper to format time ago
  function timeAgo(timestamp: string) {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)} hr ago`;
    return `${Math.floor(diff/86400)}d ago`;
  }

  // Get dominant emotion from recent whispers
  const getDominantEmotion = () => {
    const emotionCounts: Record<string, number> = {};
    whispers.slice(0, 50).forEach(whisper => {
      emotionCounts[whisper.emotion] = (emotionCounts[whisper.emotion] || 0) + 1;
    });
    
    let maxCount = 0;
    let dominant = 'joy';
    Object.entries(emotionCounts).forEach(([emotion, count]) => {
      if (count > maxCount) {
        maxCount = count;
        dominant = emotion;
      }
    });
    
    return dominant;
  };

  const dominantEmotion = getDominantEmotion();

  // Get presence count (unique users in last 12 hours)
  const getPresenceCount = () => {
    // If guest_id is present, count unique guest_ids
    const uniqueGuests = new Set();
    whispers.forEach(whisper => {
      if (whisper.guest_id) uniqueGuests.add(whisper.guest_id);
    });
    return uniqueGuests.size; // Removed fallback to random number
  };

  const presenceCount = getPresenceCount();

  const logZoneUsage = (zone: string) => {
    const usage = JSON.parse(localStorage.getItem('aangan_zone_usage') || '{}');
    usage[zone] = (usage[zone] || 0) + 1;
    localStorage.setItem('aangan_zone_usage', JSON.stringify(usage));
  };
  const logAIReplyEvent = (type: 'success' | 'timeout') => {
    const events = JSON.parse(localStorage.getItem('aangan_ai_reply_events') || '[]');
    events.push({ type, timestamp: new Date().toISOString() });
    localStorage.setItem('aangan_ai_reply_events', JSON.stringify(events));
  };

  const handleWhisperCreate = async (content: string, emotion: string, useAI: boolean) => {
    const newWhisper: Whisper = {
      id: Date.now().toString(),
      content,
      emotion: emotion as APIWhisper["emotion"],
      zone: 'courtyard',
      timestamp: new Date().toISOString(),
      isActive: true,
      likes: 0,
      replies: 0,
      created_at: new Date().toISOString(),
    };

    // Track whisper timestamps for emotional momentum
    if (typeof window !== 'undefined') {
      const now = Date.now();
      let timestamps = JSON.parse(localStorage.getItem('aangan_whisper_timestamps') || '[]');
      timestamps = timestamps.filter((t: number) => now - t < 7 * 24 * 60 * 60 * 1000); // last 7 days
      timestamps.push(now);
      localStorage.setItem('aangan_whisper_timestamps', JSON.stringify(timestamps));
      // If 3 or more in last 7 days, unlock soft title
      if (timestamps.length === 3 && !localStorage.getItem('aangan_soft_title')) {
        const titles = ['Seeker', 'Night Owl', 'Silent Companion'];
        const unlockedTitle = titles[Math.floor(Math.random() * titles.length)];
        localStorage.setItem('aangan_soft_title', unlockedTitle);
        toast('You’ve whispered 3 times — the courtyard listens better now. Soft title unlocked: “' + unlockedTitle + '” (just for you)');
      }
      // Analytics: log zone usage
      logZoneUsage(newWhisper.zone);
    }

    // Optimistically add the whisper to the UI
    // setWhispers(prev => [newWhisper, ...prev]); // This line is removed as whispers are now fetched directly
    updateEmotionStreak(emotion);

    // Simulate network request
    const promise = new Promise((resolve, reject) => {
      setTimeout(() => {
        // Simulate a 20% chance of failure
        if (Math.random() > 0.8) {
          reject("Failed to post whisper.");
        } else {
          resolve("Whisper posted successfully!");
        }
      }, 1000);
    });

    toast.promise(promise, {
      loading: 'Posting whisper...',
      success: (message) => {
        return message as string;
      },
      error: (error) => {
        // Revert the UI if the request fails
        // setWhispers(prev => prev.filter(w => w.id !== newWhisper.id)); // This line is removed
        return error;
      },
    });
  };

  const handleWhisperTap = (whisper: Whisper) => {
    setSelectedWhisper(whisper);
  };

  const handleWhisperLongPress = (whisper: Whisper) => {
    // Echo functionality
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 3000); // Hide confetti after 3 seconds
  };

  const handleWhisperSwipeLeft = (whisper: Whisper) => {
    // setWhispers(prev => prev.filter(w => w.id !== whisper.id)); // This line is removed
    toast('Your whisper has drifted away.');
  };

  const handleWhisperHeart = (whisper: Whisper) => {
    // Ripple animation - no counter shown
  };

  // Add state to track replies for user's whispers
  const [whisperReplies, setWhisperReplies] = useState<Record<string, WhisperReply[]>>({});
  const guestId = localStorage.getItem('aangan_guest_id') || undefined;

  useEffect(() => {
    if (!guestId || !whispers) return;
    // For each whisper authored by the user, fetch replies
    whispers.forEach((whisper) => {
      if (whisper.guest_id === guestId) {
        fetch(`/api/whispers/${whisper.id}/replies?guest_id=${guestId}`)
          .then(res => res.ok ? res.json() : [])
          .then(data => {
            setWhisperReplies(prev => ({ ...prev, [whisper.id]: data }));
          });
      }
    });
  }, [whispers, guestId]);

  useEffect(() => {
    const pulseInterval = setInterval(() => {
      setPulseIndex((prev) => (prev + 1) % pulseMessages.length);
      setEchoIndex((prev) => (prev + 1) % echoMessages.length);
    }, 30000);
    return () => clearInterval(pulseInterval);
  }, []);

  function openRepliesModal(whisperId: string) {
    // Type guard: ensure replies are array of objects
    const replies = whisperReplies[whisperId];
    setActiveReplies(Array.isArray(replies) ? replies : []);
    setActiveWhisper(whisperId);
    setShowRepliesModal(true);
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 3000); // Hide confetti after 3 seconds
  }
  function closeRepliesModal() {
    setShowRepliesModal(false);
    setActiveReplies([]);
    setActiveWhisper(null);
  }

  // Helper to filter top 3 real whispers from last 12 hours
  const getTopRealWhispers = (whispers: Whisper[]) => {
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    return whispers
      .filter(w => !w.isAIGenerated && !w.is_ai_generated && !(w as WhisperWithAI).isGhost && new Date(w.timestamp).getTime() > twelveHoursAgo)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 3);
  };

  // Helper to check if a whisper is a ghost
  const isGhostWhisper = (whisper: WhisperWithAI) => {
    return whisper.isAIGenerated || whisper.is_ai_generated;
  };

  const topRealWhispers = getTopRealWhispers(whispers);

  // Helper to get whispers from the user's current or default zone
  const getZoneWhispers = (whispers: Whisper[], zone: string) => {
    return whispers.filter(w => w.zone === zone && !isGhostWhisper(w as WhisperWithAI));
  };

  // Example: get user's current zone from context or default to 'quad'
  const userZone = (typeof window !== 'undefined' && localStorage.getItem('aangan_user_zone')) || 'quad';
  const zoneWhispers = getZoneWhispers(whispers, userZone);

  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Memoized WhisperCard row for react-window
  const WhisperRow = memo(({ index, style, data }: ListChildComponentProps) => {
    const whisper = data.whispers[index];
    const ghost = data.isGhostWhisper(whisper);
    const prefersReducedMotion = data.prefersReducedMotion;
    return (
      <div style={style}>
        <Suspense fallback={<WhisperSkeleton className="my-2" />}> 
          {/* Show reply badge if user is author and there are replies */}
          {whisper.guest_id === data.guestId && data.whisperReplies[whisper.id]?.length > 0 && (
            <span
              className="inline-block bg-green-500 text-white text-xs rounded px-2 py-0.5 mr-2 cursor-pointer"
              onClick={() => data.openRepliesModal(whisper.id)}
            >
              Reply
            </span>
          )}
          <div onClick={() => whisper.guest_id === data.guestId && data.whisperReplies[whisper.id]?.length > 0 ? data.openRepliesModal(whisper.id) : undefined}>
            <div className="flex items-center gap-2 mb-1">
              {ghost && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Ghost className="w-4 h-4 text-indigo-400" /> from the breeze
                </span>
              )}
            </div>
            <WhisperCard
              whisper={whisper}
              isAI={whisper.isAIGenerated ?? whisper.is_ai_generated}
              onTap={() => data.handleWhisperTap(whisper)}
            />
          </div>
        </Suspense>
      </div>
    );
  });

  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.focus();
    }
  }, []);

  const location = useLocation();

  // Render logic for main feed
  return (
    <ErrorBoundary narratorLine="A gentle hush falls over the campus. Something went adrift in the courtyard.">
      <DreamLayout>
        {/* Subtle ambient presence indicator */}
        <div className="fixed top-0 left-1/2 transform -translate-x-1/2 z-30 mt-2 animate-pulse bg-indigo-100 text-indigo-700 rounded-full px-4 py-1 shadow text-xs">
          Real humans are present now
        </div>
        <main
          role="main"
          aria-labelledby="page-title"
          tabIndex={-1}
          ref={mainRef}
          className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center pt-24 pb-16 px-4"
        >
          <h1 id="page-title" className="sr-only">Home Feed</h1>
          {/* Remove DreamHeader from here; only show in Lounge */}
          {/* Remove GentlePresenceRibbon from here; only show in Lounge or relevant pages */}
          {/* Poetic Emotion Banner */}
          <div className="pt-6 pb-3 px-4">
            <PoeticEmotionBanner
              dominantEmotion={dominantEmotion}
              timeOfDay={systemTime}
            />
          </div>
            {/* Recently Whispered Section */}
            {recentWhispers.length > 0 && (
              <div className="mb-6 px-4">
                <div className="font-semibold text-indigo-700 mb-2 text-lg flex items-center gap-2">
                  <span>Recently Whispered…</span>
                  <span className="text-xs text-gray-400 font-normal">(across all zones)</span>
                </div>
                <div className="space-y-2">
                  {recentWhispers.map((whisper) => (
                    <div key={whisper.id} className="bg-white/80 rounded-lg shadow p-3 flex flex-col gap-1 border border-indigo-50">
                      <div className="text-sm text-gray-700 line-clamp-2">{whisper.content}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-indigo-400">{whisper.emotion}</span>
                        <span className="text-xs text-gray-400">· {timeAgo(whisper.timestamp)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Top 3 Real Whispers Section */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 30 }}
              animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
              className="mb-8 border-b border-gray-200 pb-6 shadow-sm"
              aria-label="Top Whispers Section"
            >
              <div className="font-semibold text-green-700 mb-2 text-lg flex items-center gap-2">
                <span>Top Whispers (last 12h)</span>
                <span className="text-xs text-gray-400 font-normal">(real, anonymized)</span>
              </div>
              <div className="space-y-2">
                {topRealWhispers.map((whisper) => (
                  <div key={whisper.id} className="bg-white/90 rounded-lg shadow p-3 flex flex-col gap-1 border border-green-50">
                    <div className="text-sm text-gray-800 line-clamp-2">{whisper.content}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-green-500">{whisper.emotion}</span>
                      <span className="text-xs text-gray-400">· {timeAgo(whisper.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Trending/Zone Section */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 30 }}
              animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease: 'easeInOut' }}
              className="mb-8 border-b border-gray-200 pb-6 shadow-sm"
              aria-label="Trending/Zone Section"
            >
              <div className="font-semibold text-blue-700 mb-2 text-lg flex items-center gap-2">
                <span>Whispers from your campus</span>
                <span className="text-xs text-gray-400 font-normal">({userZone})</span>
              </div>
              <div className="space-y-2">
                {zoneWhispers.slice(0, 3).map((whisper) => (
                  <div key={whisper.id} className="bg-blue-50/90 rounded-lg shadow p-3 flex flex-col gap-1 border border-blue-100">
                    <div className="text-sm text-blue-900 line-clamp-2">{whisper.content}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-blue-500">{whisper.emotion}</span>
                      <span className="text-xs text-gray-400">· {timeAgo(whisper.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Live Pulse Section */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 30 }}
              animate={prefersReducedMotion ? false : { opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4, ease: 'easeInOut' }}
              className="mb-8"
              aria-label="Live Pulse Section"
            >
              <div className="w-full flex flex-col items-center mb-4">
                <div className="rounded-full bg-indigo-50/80 px-4 py-2 shadow text-indigo-700 font-medium text-base flex items-center gap-2 animate-pulse">
                  {pulseMessages[pulseIndex]}
                </div>
                <div className="mt-2 rounded-full bg-green-50/80 px-4 py-1 shadow text-green-700 text-sm flex items-center gap-2 animate-fade-in">
                  {echoMessages[echoIndex]}
                </div>
              </div>
            </motion.div>
            {/* Confetti on echo/reply */}
            {showConfetti && <ConfettiEffect isActive={showConfetti} />}

            {/* Header */}
            {/* The DreamHeader is now outside the main content */}

            <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 relative">
              {/* Soft-scrollable whispers */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="space-y-6"
              >
                {isLoading && offset === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-4 animate-pulse">🪶</div>
                    <p className="text-neutral-600 italic">Loading whispers...</p>
                  </div>
                ) : error && (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-4">⚠️</div>
                    <p className="text-red-600 italic">Failed to load whispers. Please try again later.</p>
                  </div>
                )}
                {allWhispers.length === 0 && !isLoading && !error ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-4">🪶</div>
                    <p className="text-neutral-600 italic">
                      The courtyard is quiet today. Perfect for reflection.
                    </p>
                  </div>
                ) : (
                  <List
                    height={Math.min(600, allWhispers.length * 120)}
                    itemCount={allWhispers.length}
                    itemSize={120}
                    width={"100%"}
                    itemData={{
                      whispers: allWhispers,
                      isGhostWhisper,
                      prefersReducedMotion,
                      WhisperCard: (props: any) => <WhisperCardWithFallback {...props} />, // Use wrapper for media fallback
                      guestId,
                      whisperReplies,
                      openRepliesModal,
                      handleWhisperTap,
                    }}
                    style={{ overflowX: 'hidden' }}
                  >
                    {WhisperRow}
                  </List>
                )}
              </motion.div>
              {/* Load More button */}
              {hasMore && !isLoading && !error && (
                <div className="flex justify-center mt-6">
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoadingMore || isFetching}
                    className="px-6 py-2 rounded bg-indigo-600 text-white font-semibold shadow hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {isLoadingMore || isFetching ? 'Loading...' : 'Load More'}
                  </button>
                </div>
              )}

              {/* Embedded Bench Composer */}
              {/* Removed EmbeddedBenchComposer and related floating action button */}
            </div>
            {/* Floating Help Icon */}
            {!showHelp && (
              <button
                className="fixed bottom-24 right-6 z-40 bg-white/90 rounded-full shadow-lg p-3 transition-transform duration-150 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                aria-label="Open help modal"
                onClick={() => setShowHelp(true)}
              >
                <HelpCircle className="w-6 h-6 text-indigo-700" />
              </button>
            )}
            {/* Help Modal */}
            {showHelp && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 animate-fade-in">
                <div className="bg-white rounded-xl shadow-xl p-6 max-w-xs w-full text-center animate-fade-in">
                  <h2 className="text-lg font-serif text-indigo-700 mb-2">How to use Aangan</h2>
                  <ul className="text-sm text-gray-700 mb-4 space-y-1">
                    <li>Tap to open a whisper</li>
                    <li>Long press to echo</li>
                    <li>Swipe left to let go</li>
                  </ul>
                  <button
                    className="mt-2 px-4 py-1.5 rounded bg-indigo-100 text-indigo-700 font-medium shadow hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    onClick={() => setShowHelp(false)}
                    aria-label="Close help modal"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </main>
        </DreamLayout>
      {selectedWhisper && (
        <Dialog open={!!selectedWhisper} onOpenChange={() => setSelectedWhisper(null)}>
          <DialogContent className="bg-aangan-background text-aangan-text-primary">
            {/* Back Button */}
            <button
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  setSelectedWhisper(null);
                }
              }}
              className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 hover:bg-white text-aangan-primary font-medium shadow"
              aria-label="Back"
            >
              <span style={{fontSize: '1.5rem', lineHeight: 1}}>&larr;</span> Back
            </button>
            <DialogHeader>
              <DialogTitle>{selectedWhisper.emotion}</DialogTitle>
              <button onClick={() => setSelectedWhisper(null)} className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </DialogHeader>
            <div className="p-4">
              <p>{selectedWhisper.content}</p>
            </div>
            <SoftBack />
          </DialogContent>
        </Dialog>
      )}
      {/* Replies Modal */}
      <Dialog open={showRepliesModal} onOpenChange={closeRepliesModal}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="relative bg-white rounded-lg shadow-lg p-6 w-full max-w-md z-10">
            {activeReplies.length === 0 ? (
              <div className="text-gray-500">No replies yet.</div>
            ) : (
              <ul className="space-y-3 max-h-64 overflow-y-auto">
                {activeReplies.map((reply, idx) => (
                  <li key={reply.id || idx} className="border-b pb-2">
                    <div className="text-gray-800">{reply.content}</div>
                    <div className="text-xs text-gray-400 mt-1">{reply.created_at ? new Date(reply.created_at).toLocaleString() : ''}</div>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={closeRepliesModal} className="mt-4 px-4 py-1.5 rounded bg-indigo-600 text-white font-medium hover:bg-indigo-700">Close</button>
          </div>
        </div>
      </Dialog>
    </ErrorBoundary>
  );
};

export default Whispers;

// Add a wrapper for WhisperCard to provide fallback for broken images/audio
function WhisperCardWithFallback(props: any) {
  // You can extend this to handle image/audio errors as needed
  return (
    <WhisperCard
      {...props}
      onImageError={() => {/* show fallback UI */}}
      onAudioError={() => {/* show fallback UI */}}
    />
  );
}

// Skeleton fallback with reload button after 8s
function SkeletonWithReload() {
  const [showReload, setShowReload] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowReload(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="space-y-4 my-12 flex flex-col items-center">
      {Array.from({ length: 5 }).map((_, i) => (
        <WhisperSkeleton key={i} />
      ))}
      {showReload && (
        <button
          className="mt-6 px-6 py-2 rounded bg-indigo-600 text-white font-semibold shadow hover:bg-indigo-700 transition"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      )}
    </div>
  );
}
