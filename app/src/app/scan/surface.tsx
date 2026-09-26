import { router } from 'expo-router';

import { CaptureCamera } from '@/features/capture';
import { useScanDraft } from '@/features/scan';

export default function SurfaceStep() {
  const setSurface = useScanDraft((s) => s.setSurface);

  return (
    <CaptureCamera
      hint="Fill the frame with fabric, 10–20 cm away, in even light"
      onAccepted={(image, quality) => {
        setSurface(image, quality);
        router.push('/scan/label');
      }}
    />
  );
}
