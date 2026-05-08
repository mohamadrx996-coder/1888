// src/lib/pending-requests.ts - Pending transfer requests storage - TRJ BOT v4.3

export interface PendingTransfer {
  userId: string;
  username: string;
  discriminator: string;
  email: string;
  screenshotUrl: string;
  createdAt: number;
  approved: boolean | null;
}

/** Stores requestId -> PendingTransfer */
export const pendingTransfers = new Map<string, PendingTransfer>();

/** Create a new pending transfer request */
export function createPendingRequest(data: {
  userId: string;
  username: string;
  discriminator: string;
  email: string;
  screenshotUrl: string;
}): PendingTransfer {
  const request: PendingTransfer = {
    ...data,
    createdAt: Date.now(),
    approved: null,
  };
  pendingTransfers.set(data.userId, request);
  return request;
}

/** Get a pending request by userId */
export function getPendingRequest(userId: string): PendingTransfer | undefined {
  return pendingTransfers.get(userId);
}

/** Approve a pending request */
export function approveRequest(userId: string): PendingTransfer | undefined {
  const request = pendingTransfers.get(userId);
  if (request) {
    request.approved = true;
    pendingTransfers.set(userId, request);
  }
  return request;
}

/** Reject a pending request */
export function rejectRequest(userId: string): PendingTransfer | undefined {
  const request = pendingTransfers.get(userId);
  if (request) {
    request.approved = false;
    pendingTransfers.set(userId, request);
  }
  return request;
}
