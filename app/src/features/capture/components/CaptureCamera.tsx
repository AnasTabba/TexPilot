import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { assessCapture, type CapturedImage, type QualityReport } from '../quality';
import { FramingGuide } from './FramingGuide';

export interface CaptureCameraProps {
  /** Shown over the preview, e.g. "Hold 10-20 cm from the fabric". */
  hint: string;
  /** Called only for captures that pass the quality gate. */
  onAccepted: (image: CapturedImage, quality: QualityReport) => void;
}

/**
 * Camera preview + framing guide + shutter, with the quality gate applied
 * before anything leaves this component.
 */
export function CaptureCamera(props: CaptureCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  // Only one camera preview may be active at a time, so the viewfinder is
  // unmounted whenever another screen is pushed on top of this one.
  const focused = useIsFocused();

  if (!permission) return <Screen />;

  if (!permission.granted) {
    return (
      <Screen footer={<Button title="Allow camera" onPress={requestPermission} />}>
        <Text variant="heading">Camera access needed</Text>
        <Text muted>TexPilot photographs the fabric and its care label to check them.</Text>
      </Screen>
    );
  }

  return <View style={styles.root}>{focused ? <Viewfinder {...props} /> : null}</View>;
}

function Viewfinder({ hint, onAccepted }: CaptureCameraProps) {
  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string[]>([]);

  async function capture() {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      const image = { uri: photo.uri, width: photo.width, height: photo.height };
      const report = await assessCapture(image);
      if (report.passed) {
        setRejection([]);
        onAccepted(image, report);
      } else {
        setRejection(report.reasons);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setReady(true)}
      />
      <FramingGuide hint={hint} />
      <View style={styles.controls}>
        {rejection.map((reason) => (
          <Text key={reason} style={styles.rejection}>
            {reason}
          </Text>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          disabled={!ready || busy}
          onPress={capture}
          style={({ pressed }) => [
            styles.shutter,
            (pressed || !ready || busy) && styles.shutterDimmed,
          ]}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  rejection: {
    color: colors.onPrimary,
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.onPrimary,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  shutterDimmed: { opacity: 0.5 },
});
