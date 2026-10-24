import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api';
import ServerActions from '../components/ServerActions';
import { jobFixture, renderWithProviders, serverFixture } from './utils';

describe('verified server controls', () => {
  it('shows UUID and downtime warning, disables invalid state, and submits only once', async () => {
    const user = userEvent.setup();
    const server = serverFixture();
    let resolveRequest!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    const post = vi.spyOn(api, 'post').mockImplementation((() => pending) as typeof api.post);
    renderWithProviders(<ServerActions server={server} />);
    expect(screen.getByRole('button', { name: `Start ${server.title}` })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: `Stop ${server.title}` }));
    expect(screen.getByRole('dialog')).toHaveTextContent(server.uuid);
    expect(screen.getByRole('dialog')).toHaveTextContent('Layanan pada VPS menjadi tidak tersedia');
    const confirmation = screen.getByRole('button', { name: 'Ya, stop server' });
    await user.dblClick(confirmation);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`/api/servers/${server.uuid}/actions`, { action: 'stop' });
    resolveRequest(jobFixture({ serverUuid: server.uuid }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Operasi dikirim ke UpCloud')).toBeInTheDocument();
    expect(screen.queryByText('Stop terverifikasi')).not.toBeInTheDocument();
  });
});
