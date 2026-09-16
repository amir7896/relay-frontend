import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import type { Workflow, WorkflowActionType, WorkflowTriggerType } from '../../../api/types';

const TRIGGER_OPTIONS: Array<{ value: WorkflowTriggerType; label: string; hint: string }> = [
  {
    value: 'message_contains',
    label: 'Message contains…',
    hint: 'Runs when someone posts a message with your keyword.',
  },
  {
    value: 'channel_created',
    label: 'Channel is created',
    hint: 'Runs when a new channel is created in this workspace (if scoped here).',
  },
  {
    value: 'manual',
    label: 'Manual only',
    hint: 'Only runs when you click Run.',
  },
];

const ACTION_OPTIONS: Array<{ value: WorkflowActionType; label: string; hint: string }> = [
  {
    value: 'post_message',
    label: 'Post a message',
    hint: 'Posts an automated reply in this channel.',
  },
  {
    value: 'webhook',
    label: 'Call a webhook',
    hint: 'Sends a POST to your HTTPS endpoint.',
  },
  {
    value: 'set_reminder',
    label: 'Set a reminder',
    hint: 'Reminds the workflow owner about the triggering message.',
  },
];

function defaultName(
  triggerType: WorkflowTriggerType,
  actionType: WorkflowActionType,
  keyword: string,
): string {
  const trigger =
    triggerType === 'message_contains'
      ? `When message contains “${keyword || '…'}”`
      : triggerType === 'channel_created'
        ? 'When channel is created'
        : 'Manual run';
  const action =
    actionType === 'post_message'
      ? 'post a message'
      : actionType === 'webhook'
        ? 'call webhook'
        : 'set a reminder';
  return `${trigger} → ${action}`.slice(0, 160);
}

function summarize(workflow: Workflow): string {
  const trigger =
    workflow.triggerType === 'message_contains'
      ? `contains “${String(workflow.triggerConfig.contains ?? '')}”`
      : workflow.triggerType === 'channel_created'
        ? 'channel created'
        : 'manual';
  const action =
    workflow.actionType === 'post_message'
      ? 'post message'
      : workflow.actionType === 'webhook'
        ? 'webhook'
        : `remind in ${Number(workflow.actionConfig.delayMinutes ?? 60)}m`;
  return `${trigger} → ${action}`;
}

export function WorkflowsPanel({ conversationId }: { conversationId: string }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>('message_contains');
  const [actionType, setActionType] = useState<WorkflowActionType>('post_message');
  const [keyword, setKeyword] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [delayMinutes, setDelayMinutes] = useState('60');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState('');

  const triggerHint = useMemo(
    () => TRIGGER_OPTIONS.find((item) => item.value === triggerType)?.hint ?? '',
    [triggerType],
  );
  const actionHint = useMemo(
    () => ACTION_OPTIONS.find((item) => item.value === actionType)?.hint ?? '',
    [actionType],
  );

  async function loadWorkflows() {
    setError('');
    try {
      const response = await api<Workflow[]>(
        `/chat/conversations/${conversationId}/workflows`,
      );
      setWorkflows(response.data ?? []);
    } catch {
      setError('Workflows are not available yet.');
    }
  }

  useEffect(() => {
    void loadWorkflows();
  }, [conversationId]);

  async function createWorkflow(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const triggerConfig =
        triggerType === 'message_contains' ? { contains: keyword.trim() } : {};
      const actionConfig =
        actionType === 'post_message'
          ? { body: messageBody.trim() }
          : actionType === 'webhook'
            ? { url: webhookUrl.trim() }
            : { delayMinutes: Number(delayMinutes) || 60 };

      const response = await api<Workflow>(
        `/chat/conversations/${conversationId}/workflows`,
        {
          method: 'POST',
          body: JSON.stringify({
            name:
              name.trim() ||
              defaultName(triggerType, actionType, keyword.trim()),
            triggerType,
            actionType,
            triggerConfig,
            actionConfig,
            enabled: true,
          }),
        },
      );
      setWorkflows((current) => [response.data, ...current]);
      setName('');
      setKeyword('');
      setMessageBody('');
      setWebhookUrl('');
      setDelayMinutes('60');
      setNotice('Workflow created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workflow.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleWorkflow(workflow: Workflow) {
    setError('');
    try {
      const response = await api<Workflow>(
        `/chat/conversations/${conversationId}/workflows/${workflow.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !workflow.enabled }),
        },
      );
      setWorkflows((current) =>
        current.map((row) => (row.id === workflow.id ? response.data : row)),
      );
    } catch {
      setError('Could not update the workflow.');
    }
  }

  async function deleteWorkflow(id: string) {
    setError('');
    try {
      await api(`/chat/conversations/${conversationId}/workflows/${id}`, {
        method: 'DELETE',
      });
      setWorkflows((current) => current.filter((row) => row.id !== id));
    } catch {
      setError('Could not delete the workflow.');
    }
  }

  async function runWorkflow(id: string) {
    setRunningId(id);
    setError('');
    setNotice('');
    try {
      await api(`/chat/conversations/${conversationId}/workflows/${id}/run`, {
        method: 'POST',
      });
      setNotice('Workflow ran.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the workflow.');
    } finally {
      setRunningId('');
    }
  }

  return (
    <section className="feature-panel workflows-panel">
      <div className="feature-panel-head">
        <div>
          <h3>Workflow builder</h3>
          <p className="muted">
            No-code automations for this channel: pick a trigger, then an action.
          </p>
        </div>
      </div>

      {error ? <p className="error tab-notice">{error}</p> : null}
      {notice ? (
        <p className="muted tab-notice" role="status">
          {notice}
        </p>
      ) : null}

      <form className="workflow-create" onSubmit={createWorkflow}>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Optional — auto-named if blank"
            maxLength={160}
          />
        </label>

        <div className="workflow-builder-row">
          <label>
            When
            <select
              value={triggerType}
              onChange={(event) =>
                setTriggerType(event.target.value as WorkflowTriggerType)
              }
            >
              {TRIGGER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="muted">{triggerHint}</small>
          </label>

          <label>
            Then
            <select
              value={actionType}
              onChange={(event) =>
                setActionType(event.target.value as WorkflowActionType)
              }
            >
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="muted">{actionHint}</small>
          </label>
        </div>

        {triggerType === 'message_contains' ? (
          <label>
            Keyword
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="e.g. help, deploy, urgent"
              required
              maxLength={200}
            />
          </label>
        ) : null}

        {actionType === 'post_message' ? (
          <label>
            Message to post
            <textarea
              value={messageBody}
              onChange={(event) => setMessageBody(event.target.value)}
              placeholder="Thanks — someone from the team will reply shortly."
              rows={3}
              required
              maxLength={4000}
            />
          </label>
        ) : null}

        {actionType === 'webhook' ? (
          <label>
            Webhook URL (HTTPS)
            <input
              type="url"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="https://example.com/hooks/relay"
              required
            />
          </label>
        ) : null}

        {actionType === 'set_reminder' ? (
          <label>
            Remind after (minutes)
            <input
              type="number"
              min={1}
              max={43200}
              value={delayMinutes}
              onChange={(event) => setDelayMinutes(event.target.value)}
              required
            />
          </label>
        ) : null}

        {actionType === 'set_reminder' && triggerType !== 'message_contains' ? (
          <p className="muted tab-notice">
            Reminder actions need a triggering message. Use “Message contains…” or Run
            will skip the reminder step.
          </p>
        ) : null}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create workflow'}
        </button>
      </form>

      <ul className="workflow-list">
        {workflows.map((workflow) => (
          <li key={workflow.id} className="workflow-card">
            <div className="workflow-card-main">
              <strong>{workflow.name}</strong>
              <small className="muted">{summarize(workflow)}</small>
              <span
                className={`workflow-status${workflow.enabled ? ' on' : ''}`}
              >
                {workflow.enabled ? 'Active' : 'Paused'}
              </span>
            </div>
            <div className="workflow-card-actions">
              <button
                className="ghost"
                type="button"
                onClick={() => void runWorkflow(workflow.id)}
                disabled={runningId === workflow.id || !workflow.enabled}
              >
                {runningId === workflow.id ? 'Running…' : 'Run'}
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => void toggleWorkflow(workflow)}
              >
                {workflow.enabled ? 'Pause' : 'Enable'}
              </button>
              <button
                className="ghost danger-link"
                type="button"
                onClick={() => void deleteWorkflow(workflow.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!error && workflows.length === 0 ? (
        <p className="muted tab-empty">No workflows yet. Build one above.</p>
      ) : null}
    </section>
  );
}
