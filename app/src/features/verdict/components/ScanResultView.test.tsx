import { render, screen } from '@testing-library/react-native';

import { abstainResult, flagResult, passResult } from '@/api/fixtures';

import { ScanResultView } from './ScanResultView';

describe('<ScanResultView />', () => {
  test('PASS shows the predictions and the stated composition', async () => {
    await render(<ScanResultView result={passResult} />);
    expect(screen.getByText('Consistent')).toBeOnTheScreen();
    expect(screen.getByText('Denim (91%)')).toBeOnTheScreen();
    expect(screen.getByText('Cotton')).toBeOnTheScreen();
    expect(screen.queryByText(/why it was flagged/i)).not.toBeOnTheScreen();
  });

  test('FLAG explains why', async () => {
    await render(<ScanResultView result={flagResult} />);
    expect(screen.getByText('Mismatch flagged')).toBeOnTheScreen();
    expect(screen.getByText(/label states 100% polyester/)).toBeOnTheScreen();
  });

  test('INSUFFICIENT_EVIDENCE is a normal result, with undetermined heads shown plainly', async () => {
    await render(<ScanResultView result={abstainResult} />);
    expect(screen.getByText('Not enough evidence')).toBeOnTheScreen();
    expect(screen.getAllByText('Not determined')).toHaveLength(3);
    // The label was still read, so its composition is still shown.
    expect(screen.getByText('Polyester')).toBeOnTheScreen();
  });
});
