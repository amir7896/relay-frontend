import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Conversation, Paginated, UserProfile } from '../api/types';

export function PeoplePage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<UserProfile | null>(null);

  async function load(term = search) {
    setError('');
    const query = new URLSearchParams({ page: '1', limit: '50' });
    if (term.trim()) {
      query.set('search', term.trim());
    }
    try {
      const response = await api<Paginated<UserProfile>>(`/users?${query}`);
      setUsers(response.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admins only');
    }
  }

  useEffect(() => {
    if (session?.user.role === 'admin') {
      void load('');
    }
  }, [session?.user.role]);

  async function message(user: UserProfile) {
    const response = await api<Conversation>('/chat/private', {
      method: 'POST',
      body: JSON.stringify({ userId: user.userId }),
    });
    navigate(`/chat/${response.data.id}`);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    const form = new FormData(event.currentTarget);
    await api<UserProfile>(`/users/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
      }),
    });
    setEditing(null);
    await load();
  }

  async function deactivate(user: UserProfile) {
    if (!window.confirm(`Deactivate ${user.firstName} ${user.lastName}?`)) {
      return;
    }
    await api(`/users/${user.id}`, { method: 'DELETE' });
    await load();
  }

  if (session?.user.role !== 'admin') {
    return (
      <main className="page">
        <h1>People</h1>
        <p className="muted">Only admins can open the directory.</p>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted">Search the directory, start a chat, or update a profile.</p>
        </div>
        <form
          className="search-bar"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or email"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <div className="panel table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.firstName} {user.lastName}
                </td>
                <td>{user.email}</td>
                <td className="row-actions">
                  <button className="ghost" type="button" onClick={() => void message(user)}>
                    Message
                  </button>
                  <button className="ghost" type="button" onClick={() => setEditing(user)}>
                    Edit
                  </button>
                  <button className="danger-text" type="button" onClick={() => void deactivate(user)}>
                    Deactivate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 ? <p className="muted empty">No people yet.</p> : null}
      </div>

      {editing ? (
        <form className="panel" onSubmit={(event) => void saveEdit(event)}>
          <h2>
            Edit {editing.firstName} {editing.lastName}
          </h2>
          <div className="split">
            <label>
              First name
              <input name="firstName" defaultValue={editing.firstName} required />
            </label>
            <label>
              Last name
              <input name="lastName" defaultValue={editing.lastName} required />
            </label>
          </div>
          <div className="row">
            <button className="btn" type="submit">
              Save
            </button>
            <button className="ghost" type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}
