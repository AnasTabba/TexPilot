/**
 * Offline queue (spec sections 4.4 and 7) -- NOT IMPLEMENTED. Task T5 in
 * app/README.md.
 *
 * A factory goods-in desk will not always have wifi. When a scan cannot reach
 * the server (ApiError.isRetryable), it is queued on-device and uploaded when
 * the network comes back. The operator sees it as "pending", not as an error.
 *
 * Things to get right:
 * - Camera URIs are temporary cache files. Copy images into permanent storage
 *   (expo-file-system) before queueing, and delete them after upload.
 * - Persist the queue itself (the history store shows the zustand + AsyncStorage
 *   pattern) so it survives an app restart.
 * - Flush on reconnect (@react-native-community/netinfo) and on app foreground.
 * - Never retry an `http` 4xx: the server has already said no.
 * - Scans are uploaded in capture order, one at a time.
 */

export interface QueuedScan {
  /** Local id; the server's scan_id only exists once it has been uploaded. */
  localId: string;
  /** Permanent (not cache) URI of the surface photo. */
  surfaceImageUri: string;
  labelText?: string;
  capturedAt: string;
  attempts: number;
  lastError?: string;
}
