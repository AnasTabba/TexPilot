import { router } from 'expo-router';

import { Button, Screen, Text, TextField } from '@/components/ui';
import { useScanDraft } from '@/scanner';

/**
 * Care-label step. Typed text is a stop-gap: T3 replaces it with a label photo
 * and OCR, at which point the API takes `label_image` instead of `label_text`.
 */
export default function LabelStep() {
  const labelText = useScanDraft((s) => s.labelText);
  const setLabelText = useScanDraft((s) => s.setLabelText);

  function skip() {
    setLabelText('');
    router.push('/scan/review');
  }

  return (
    <Screen
      footer={
        <>
          <Button
            title="Continue"
            disabled={!labelText.trim()}
            onPress={() => router.push('/scan/review')}
          />
          <Button title="No label — skip" variant="secondary" onPress={skip} />
        </>
      }
    >
      <Text variant="heading">What does the care label say?</Text>
      <Text muted>Type the fibre composition exactly as printed.</Text>
      <TextField
        label="Composition"
        value={labelText}
        onChangeText={setLabelText}
        placeholder="60% COTTON 40% POLYESTER"
        autoCapitalize="characters"
        autoCorrect={false}
        multiline
      />
      <Text variant="caption" muted>
        Without a label the scanner has nothing to check the fabric against, so it will usually
        return “Not enough evidence”.
      </Text>
    </Screen>
  );
}
