import React, { useState, ReactNode } from "react";
import { Whisper, WhispersContextType } from './WhispersContext.helpers';
import { WhispersContext } from './WhispersContext.context';

export const WhispersProvider = ({ children }: { children: ReactNode }) => {
  const [whispers, setWhispers] = useState<Whisper[]>([]);
  const addWhisper = (whisper: Whisper) => setWhispers((prev) => [whisper, ...prev]);
  const value: WhispersContextType = { whispers, setWhispers, addWhisper };
  return (
    <WhispersContext.Provider value={value}>
      {children}
    </WhispersContext.Provider>
  );
};

export const useWhispers = () => {
  const ctx = React.useContext(WhispersContext);
  if (!ctx) throw new Error('useWhispers must be used within a WhispersProvider');
  return ctx;
}; 