import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../api';
import { TokenFormModal } from '../components/TokenForm';
import { renderWithProviders, serverFixture } from './utils';

describe('token registration workflow', () => {
  it('validates real discovery results and enforces two display selections', async () => {
    const user = userEvent.setup();
    const servers = ['VPS One', 'VPS Two', 'VPS Three'].map((title, index) => {
      const server = serverFixture({ title });
      return { uuid: server.uuid.slice(0, -1) + index, title, state: 'started', zone: server.zone, coreNumber: 2, memoryMib: 2048 };
    });
    const validation = { valid: true, servers, maskedToken: 'ucat_••••abcd', account: { username: 'owner' } };
    const post = vi.spyOn(api, 'post').mockImplementation(((path: string) => {
      if (path === '/api/tokens/validate') return Promise.resolve(validation);
      if (path === '/api/tokens') return Promise.resolve({ serverCount: 3 });
      return Promise.reject(new Error(`Unexpected ${path}`));
    }) as typeof api.post);
    renderWithProviders(<TokenFormModal onClose={() => {}} />);
    const secret = 'ucat_test_secret_not_persisted_123456';
    await user.type(screen.getByLabelText(/Nama grup token/), 'CerdasNet Production');
    await user.type(screen.getByLabelText(/API token UpCloud/), secret);
    await user.click(screen.getByRole('button', { name: 'Validasi token' }));
    expect(await screen.findByText('VPS Three')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /VPS One/ }));
    await user.click(screen.getByRole('button', { name: /VPS Two/ }));
    await user.click(screen.getByRole('button', { name: /VPS Three/ }));
    expect(screen.getAllByText('Maksimal dua VPS per grup').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Simpan grup token' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({ name: 'CerdasNet Production', token: secret, selectedServerUuids: [servers[0]!.uuid, servers[1]!.uuid] });
    expect(Object.values(window.localStorage)).not.toContain(secret);
  });
});
