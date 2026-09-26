import { fireEvent, render, screen } from '@testing-library/react-native';
import { FabricExperience } from './FabricExperience';
import { useFabricLibrary } from './store';

jest.mock('@expo/vector-icons/Feather', () => 'Icon');
jest.mock('@/hooks/useBreakpoint', () => ({ useBreakpoint: () => 'compact' }));

beforeEach(() => {
  useFabricLibrary.setState({ savedIds: [] });
});

it('lets a phone user explore, filter, inspect and save a fabric reference', async () => {
  await render(<FabricExperience health="offline" onScan={jest.fn()} onHistory={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: /Get started/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Filter Cotton' }));
  expect(screen.queryByRole('button', { name: 'View Classic denim' })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'View Cotton jersey' }));
  expect(screen.getByText('Soft, simple, essential')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Save selected fabric' }));
  expect(useFabricLibrary.getState().savedIds).toEqual(['cotton-jersey']);
  await fireEvent.press(screen.getByRole('button', { name: /Tips for a better scan/ }));
  expect(screen.getByText(/Lay the fabric flat/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to fabric library' }));
  await fireEvent.press(screen.getByRole('button', { name: /Saved/ }));
  expect(screen.getByRole('button', { name: 'View Cotton jersey' })).toBeOnTheScreen();
});

it('connects scan and history actions and handles an empty search honestly', async () => {
  const onScan = jest.fn();
  const onHistory = jest.fn();
  await render(<FabricExperience health="offline" onScan={onScan} onHistory={onHistory} />);
  await fireEvent.press(screen.getByRole('button', { name: /Get started/ }));
  await fireEvent.changeText(screen.getByLabelText('Search fabrics'), 'does not exist');
  expect(screen.getByText('No fabrics found')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Start a fabric scan' }));
  expect(onScan).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: /History/ }));
  expect(onHistory).toHaveBeenCalledTimes(1);
});
