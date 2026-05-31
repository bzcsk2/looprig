import { createContext } from 'react';
export const PromptOverlayContext = createContext(null);
export function PromptOverlayProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }
export function usePromptOverlay() { return null; }
export function usePromptOverlayDialog() { return null; }
