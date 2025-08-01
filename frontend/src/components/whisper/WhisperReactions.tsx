import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '../ui/button';
import { useReactToWhisper, useWhisperReactions } from '../../services/api';
import { useRealtime } from '../../contexts/RealtimeContext';

interface WhisperReactionsProps {
  whisperId: string;
  guestId: string;
}

const REACTION_TYPES = ['💛', '🙌', '🌱'];

export const WhisperReactions: React.FC<WhisperReactionsProps> = ({
  whisperId,
  guestId
}) => {
  const [localReactions, setLocalReactions] = useState<Record<string, number>>({
    '��': 0,
    '🙌': 0,
    '🌱': 0
  });
  const [userReactions, setUserReactions] = useState<Set<string>>(new Set());

  const { data: reactionsData } = useWhisperReactions(whisperId);
  const reactMutation = useReactToWhisper();
  const { socket } = useRealtime();

  // Update local state when API data changes
  useEffect(() => {
    if (reactionsData) {
      setLocalReactions(reactionsData.reactions);
    }
  }, [reactionsData]);

  // Listen for real-time reaction updates
  useEffect(() => {
    if (!socket) return;

    const handleReactionUpdate = (data: {
      whisperId: string;
      reactions: Record<string, number>;
      guestId: string;
      reactionType: string;
      action: 'added' | 'removed';
    }) => {
      if (data.whisperId === whisperId) {
        setLocalReactions(data.reactions);
        
        // Update user reactions
        if (data.guestId === guestId) {
          setUserReactions(prev => {
            const newSet = new Set(prev);
            if (data.action === 'added') {
              newSet.add(data.reactionType);
            } else {
              newSet.delete(data.reactionType);
            }
            return newSet;
          });
        }
      }
    };

    socket.on('whisper-reaction-update', handleReactionUpdate);

    return () => {
      socket.off('whisper-reaction-update', handleReactionUpdate);
    };
  }, [socket, whisperId, guestId]);

  const handleReaction = async (reactionType: string) => {
    try {
      await reactMutation.mutateAsync({
        whisperId,
        reactionType,
        guestId
      });
    } catch (error) {
      // Log error to error reporting service in production
      if (process.env.NODE_ENV !== 'production') {
        // Only log in development
        // eslint-disable-next-line no-console
        console.error('Error reacting to whisper:', error);
      }
      // Optionally show a user-friendly error message here
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-neutral-200/50 bg-[#f9f9f9] rounded-b-xl -mx-4 -mb-4 px-4 pb-4">
      <div className="flex items-center gap-2">
        {REACTION_TYPES.map((reaction) => {
          const count = localReactions[reaction] || 0;
          const isUserReacted = userReactions.has(reaction);
          
          return (
            <motion.div
              key={reaction}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 px-3 text-sm transition-all duration-200 ${
                  isUserReacted 
                    ? 'bg-red-50 text-red-600 border border-red-200 shadow-sm' 
                    : 'hover:bg-white/80 hover:border-neutral-300'
                }`}
                onClick={() => handleReaction(reaction)}
                disabled={reactMutation.isPending}
              >
                <span className="mr-1">{reaction}</span>
                {count > 0 && (
                  <span className="text-xs font-medium">
                    {count}
                  </span>
                )}
              </Button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}; 