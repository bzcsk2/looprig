/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dialog store — tracks which dialog is currently active in the TUI.
 * Adapted from gemini-cli for Deepreef.
 */

import type { PermissionRequest, QuestionRequest } from '@covalo/core';

export type ActiveDialogKind = 'permission' | 'question' | null;

export interface DialogState {
  /** Currently active dialog kind, or null if none */
  activeDialog: ActiveDialogKind;
  /** Pending permission request, or null */
  permissionRequest: PermissionRequest | null;
  /** Pending question request, or null */
  questionRequest: QuestionRequest | null;
}

export interface DialogActions {
  /** Open the permission dialog with the given request */
  openPermission(request: PermissionRequest): void;
  /** Open the question dialog with the given request */
  openQuestion(request: QuestionRequest): void;
  /** Close the permission dialog */
  closePermission(): void;
  /** Close the question dialog */
  closeQuestion(): void;
  /** Close any active dialog */
  closeAll(): void;
  /** Check if a dialog is blocking input */
  isBlocking(): boolean;
}

export function createInitialDialogState(): DialogState {
  return {
    activeDialog: null,
    permissionRequest: null,
    questionRequest: null,
  };
}

/**
 * Derive the active dialog kind from the current state.
 * Permission takes priority over question (security critical).
 */
function deriveActiveDialog(
  permissionRequest: PermissionRequest | null,
  questionRequest: QuestionRequest | null,
): ActiveDialogKind {
  if (permissionRequest) return 'permission';
  if (questionRequest) return 'question';
  return null;
}

/**
 * Create dialog state and actions from a setState updater.
 *
 * Usage:
 * ```ts
 * const [dialog, dialogActions] = createDialogController(setDialogState);
 * ```
 */
export function createDialogController(
  setState: React.Dispatch<React.SetStateAction<DialogState>>,
): [DialogState & { isBlocking: () => boolean }, DialogActions] {
  const isBlocking = (): boolean => {
    // Read from latest state via ref pattern; for simplicity, check via callback
    let blocking = false;
    setState(prev => {
      blocking = prev.activeDialog !== null;
      return prev;
    });
    return blocking;
  };

  const actions: DialogActions = {
    openPermission(request: PermissionRequest) {
      setState(prev => ({
        ...prev,
        activeDialog: 'permission',
        permissionRequest: request,
      }));
    },
    openQuestion(request: QuestionRequest) {
      setState(prev => ({
        ...prev,
        activeDialog: 'question',
        questionRequest: request,
      }));
    },
    closePermission() {
      setState(prev => ({
        ...prev,
        activeDialog: deriveActiveDialog(null, prev.questionRequest),
        permissionRequest: null,
      }));
    },
    closeQuestion() {
      setState(prev => ({
        ...prev,
        activeDialog: deriveActiveDialog(prev.permissionRequest, null),
        questionRequest: null,
      }));
    },
    closeAll() {
      setState(createInitialDialogState());
    },
    isBlocking,
  };

  const getSnapshot = (): DialogState & { isBlocking: () => boolean } => {
    // This is a closure-based approach; the actual state is managed via setState
    // We return a proxy-like object that delegates to the latest state
    return { ...createInitialDialogState(), isBlocking };
  };

  return [getSnapshot() as DialogState & { isBlocking: () => boolean }, actions];
}
