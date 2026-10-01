export function statusLabel(state: 'idle' | 'connected' | 'disconnected'): string {
  switch (state) {
    case 'idle':
      return 'IT Studio: idle';
    case 'connected':
      return 'IT Studio: connected';
    case 'disconnected':
      return 'IT Studio: disconnected';
  }
}
