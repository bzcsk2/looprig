import { createContext } from 'react';
export const ModalContext = createContext<{
  rows: number;
  columns: number;
  scrollRef: React.RefObject<any> | null;
} | null>(null);
