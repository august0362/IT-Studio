import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { NewProjectDialog } from './NewProjectDialog';
import { pickFolder } from './pick-folder';

vi.mock('./pick-folder', () => ({ pickFolder: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function setup() {
  const onCreate = vi.fn(() => Promise.resolve());
  render(<NewProjectDialog error={null} onCancel={vi.fn()} onCreate={onCreate} />);
  return onCreate;
}

describe('folder picker', () => {
  it('fills the absolute path and prefills an empty name from the last folder segment', async () => {
    const onCreate = setup();
    vi.mocked(pickFolder).mockResolvedValue('C:\\Work\\Example\\');
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Folder path')).toHaveValue('C:\\Work\\Example\\');
    });
    expect(screen.getByLabelText('Project name')).toHaveValue('Example');
    expect(pickFolder).toHaveBeenCalledWith('Choose project folder');
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('Example', 'C:\\Work\\Example\\');
    });
  });

  it('keeps a typed name and leaves both fields unchanged on cancel', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'My name' } });
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '/original' } });
    vi.mocked(pickFolder).mockResolvedValue('/chosen');
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Folder path')).toHaveValue('/chosen');
    });
    expect(screen.getByLabelText('Project name')).toHaveValue('My name');
    vi.mocked(pickFolder).mockResolvedValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Browse…' })).toBeEnabled();
    });
    expect(screen.getByLabelText('Folder path')).toHaveValue('/chosen');
    expect(screen.getByLabelText('Project name')).toHaveValue('My name');
  });

  it('reports picker failures and still accepts a manually typed path', async () => {
    const onCreate = setup();
    vi.mocked(pickFolder).mockRejectedValue(new Error('unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the folder path or try again.');
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Manual' } });
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: 'C:/manual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('Manual', 'C:/manual');
    });
  });
});
