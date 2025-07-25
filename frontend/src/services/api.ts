import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// For local dev, set VITE_API_URL=http://localhost:3001/api in your .env file
const API_BASE_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001/api" : "https://aangan-production.up.railway.app/api");

// Types
export interface Whisper {
  id: string;
  content: string;
  emotion: "joy" | "nostalgia" | "calm" | "anxiety" | "hope" | "love";
  zone: string;
  likes: number;
  replies: number;
  timestamp: string;
  created_at: string;
  is_ai_generated?: boolean;
  isAIGenerated?: boolean;
  echoLabel?: string;
  expires_at?: string;
}

export interface CreateWhisperData {
  content: string;
  emotion: "joy" | "nostalgia" | "calm" | "anxiety" | "hope" | "love";
  zone: string;
  expiresAt?: string;
  guestId?: string;
}

export interface AnalyticsData {
  totalWhispers: number;
  whispersToday: number;
  emotionDistribution: Array<{ emotion: string; count: number }>;
  zoneDistribution: Array<{ zone: string; count: number }>;
}

export interface FeatureToggles {
  shrines: boolean;
  capsules: boolean;
  mirrorMode: boolean;
  murmurs: boolean;
}

// API functions
const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Network error" }));
    throw new Error(error.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
};

// Whisper API functions
export const fetchWhispers = async (params?: {
  zone?: string;
  emotion?: string;
  limit?: number;
  offset?: number;
  guestId?: string;
}): Promise<Whisper[]> => {
  const searchParams = new URLSearchParams();
  if (params?.zone) searchParams.append("zone", params.zone);
  if (params?.emotion) searchParams.append("emotion", params.emotion);
  if (params?.limit) searchParams.append("limit", params.limit.toString());
  if (params?.offset) searchParams.append("offset", params.offset.toString());
  if (params?.guestId) searchParams.append("guestId", params.guestId);

  const endpoint = `/whispers${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  return apiRequest(endpoint);
};

export const createWhisper = async (
  data: CreateWhisperData,
): Promise<Whisper> => {
  const response = await apiRequest("/whispers", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return response;
};

export const createWhisperWithExpiry = async (
  content: string,
  emotion: string,
  zone: string,
  expiresAt?: boolean,
  guestId?: string,
): Promise<Whisper> => {
  const data: CreateWhisperData = {
    content,
    emotion: emotion as "joy" | "nostalgia" | "calm" | "anxiety" | "hope" | "love",
    zone,
    ...(expiresAt && { expiresAt: new Date().toISOString() }),
    ...(guestId && { guestId }),
  };
  
  return createWhisper(data);
};

// Analytics API functions (admin only)
export const fetchAnalytics = async (token: string): Promise<AnalyticsData> => {
  return apiRequest("/analytics/whispers", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
};

export const fetchZoneAnalytics = async (token: string) => {
  return apiRequest("/analytics/zones", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
};

// Feature toggle API functions
export const fetchFeatureToggles = async (): Promise<FeatureToggles> => {
  return apiRequest("/features/toggles");
};

export const updateFeatureToggle = async (
  feature: string,
  enabled: boolean,
  token: string,
): Promise<{ success: boolean }> => {
  return apiRequest("/features/toggles", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ feature, enabled }),
  });
};

// Authentication API functions
export const loginAdmin = async (
  username: string,
  password: string,
): Promise<{ token: string; user: { username: string; role: string } }> => {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
};

export const verifyToken = async (
  token: string,
): Promise<{ valid: boolean; user: { username: string; role: string } }> => {
  return apiRequest("/auth/verify", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
};

// Health check
export const checkHealth = async (): Promise<{
  status: string;
  timestamp: string;
}> => {
  return apiRequest("/health");
};

// React Query hooks
export const useWhispers = (params?: {
  zone?: string;
  emotion?: string;
  limit?: number;
  offset?: number;
  guestId?: string;
}) => {
  return useQuery({
    queryKey: ["whispers", params],
    queryFn: () => fetchWhispers(params),
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });
};

export const useCreateWhisper = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createWhisper,
    onSuccess: (newWhisper) => {
      // Invalidate and refetch whispers
      queryClient.invalidateQueries({ queryKey: ["whispers"] });
      
      // Add to real-time context if available
      if (typeof window !== 'undefined' && (window as Window & { realtimeService?: { broadcastWhisper: (whisper: Whisper) => void } }).realtimeService) {
        (window as Window & { realtimeService?: { broadcastWhisper: (whisper: Whisper) => void } }).realtimeService!.broadcastWhisper(newWhisper);
      }
      
      // Dispatch whisper created event for milestones
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('whisper-created'));
      }
    },
  });
};

export const useAnalytics = (token: string) => {
  return useQuery({
    queryKey: ["analytics"],
    queryFn: () => fetchAnalytics(token),
    enabled: !!token,
    staleTime: 60000, // 1 minute
  });
};

export const useZoneAnalytics = (token: string) => {
  return useQuery({
    queryKey: ["zoneAnalytics"],
    queryFn: () => fetchZoneAnalytics(token),
    enabled: !!token,
    staleTime: 60000, // 1 minute
  });
};

export const useFeatureToggles = () => {
  return useQuery({
    queryKey: ["featureToggles"],
    queryFn: fetchFeatureToggles,
    staleTime: 300000, // 5 minutes
  });
};

export const useUpdateFeatureToggle = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      feature,
      enabled,
      token,
    }: {
      feature: string;
      enabled: boolean;
      token: string;
    }) => updateFeatureToggle(feature, enabled, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["featureToggles"] });
    },
  });
};

export const useLoginAdmin = () => {
  return useMutation({
    mutationFn: ({
      username,
      password,
    }: {
      username: string;
      password: string;
    }) => loginAdmin(username, password),
  });
};

export const useVerifyToken = (token: string) => {
  return useQuery({
    queryKey: ["verifyToken"],
    queryFn: () => verifyToken(token),
    enabled: !!token,
    staleTime: 300000, // 5 minutes
  });
};

export const useHealthCheck = () => {
  return useQuery({
    queryKey: ["health"],
    queryFn: checkHealth,
    staleTime: 60000, // 1 minute
    refetchInterval: 300000, // 5 minutes
  });
};

// Reaction API functions
export const reactToWhisper = async (
  whisperId: string,
  reactionType: string,
  guestId: string
): Promise<{
  whisperId: string;
  reactions: Record<string, number>;
  guestId: string;
  reactionType: string;
  action: 'added' | 'removed';
}> => {
  const response = await apiRequest(`/whispers/${whisperId}/react`, {
    method: "POST",
    body: JSON.stringify({ reactionType, guestId }),
  });
  return response;
};

export const getWhisperReactions = async (whisperId: string): Promise<{
  whisperId: string;
  reactions: Record<string, number>;
}> => {
  return apiRequest(`/whispers/${whisperId}/reactions`);
};

export const useWhisperReactions = (whisperId: string) => {
  return useQuery({
    queryKey: ["whisper-reactions", whisperId],
    queryFn: () => getWhisperReactions(whisperId),
    enabled: !!whisperId,
  });
};

export const useReactToWhisper = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ whisperId, reactionType, guestId }: {
      whisperId: string;
      reactionType: string;
      guestId: string;
    }) => reactToWhisper(whisperId, reactionType, guestId),
    onSuccess: (data) => {
      // Invalidate reactions for this whisper
      queryClient.invalidateQueries({ queryKey: ["whisper-reactions", data.whisperId] });
    },
  });
};

export const reportWhisper = async (
  whisperId: string,
  reason: string,
  guestId?: string
): Promise<{ success: boolean; message: string }> => {
  return apiRequest(`/whispers/${whisperId}/report`, {
    method: "POST",
    body: JSON.stringify({ reason, guest_id: guestId }),
  });
};
