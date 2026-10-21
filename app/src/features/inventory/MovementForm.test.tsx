import { fireEvent, render, screen } from '@testing-library/react-native';

import { InventoryMovementForm } from './MovementForm';
import { materials, sampleMovements } from './model';
import { useInventory } from './store';

jest.mock('@expo/vector-icons/Feather', () => 'Icon');
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ kind: 'issued', materialId: 'denim-indigo' }),
}));

beforeEach(() =>
  useInventory.setState({
    materials: materials.map((item) => ({ ...item })),
    movements: [...sampleMovements],
  }),
);

it('keeps invalid issues out of review and asks for confirmation before changing stock', async () => {
  await render(<InventoryMovementForm />);
  await fireEvent.changeText(screen.getByLabelText('Quantity in metres'), '5000');
  await fireEvent.changeText(screen.getByLabelText('Number of rolls'), '1');
  await fireEvent.changeText(screen.getByLabelText('Reference'), 'CUT-0087');
  await fireEvent.press(screen.getByRole('button', { name: 'Review issue' }));
  expect(screen.getByText(/Only 4,820 m is available/)).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Quantity in metres'), '100');
  await fireEvent.press(screen.getByRole('button', { name: 'Review issue' }));
  expect(useInventory.getState().materials[0]!.metres).toBe(6420);
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm issue' }));
  expect(screen.getByText('Stock issued')).toBeOnTheScreen();
  expect(useInventory.getState().materials[0]!.metres).toBe(6320);
});
