import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { getHealth } from '@/scanner';

export type ApiHealth = 'checking' | 'online' | 'offline';

/** Pings GET /health whenever the calling screen gains focus. */
export function useApiHealth(): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>('checking');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setHealth('checking');
      getHealth()
        .then(() => !cancelled && setHealth('online'))
        .catch(() => !cancelled && setHealth('offline'));
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return health;
}
