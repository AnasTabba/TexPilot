import { router, useIsFocused } from 'expo-router';

import { CaptureCamera, useScanDraft } from '@/scanner';

export default function SurfaceStep() {
  const setSurface = useScanDraft((s) => s.setSurface);
  // Release the camera while a later step is on top of this screen.
  const focused = useIsFocused();

  return (
    <CaptureCamera
      active={focused}
      hint="Fill the frame with fabric, 10–20 cm away, in even light"
      onAccepted={(image, quality) => {
        setSurface(image, quality);
        router.push('/scan/label');
      }}
    />
  );
}
