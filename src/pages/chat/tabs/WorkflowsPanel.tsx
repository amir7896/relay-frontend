import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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

type FocusNode = 'trigger' | 'condition' | 'action';
type WorkflowCondition = 'always' | 'weekdays' | 'require_mention';

const CONDITION_OPTIONS: Array<{
  value: WorkflowCondition;
  label: string;
  hint: string;
}> = [
  {
    value: 'always',
    label: 'Always',
    hint: 'Run whenever the trigger fires.',
  },
  {
    value: 'weekdays',
    label: 'Weekdays only',
    hint: 'Skip Saturday and Sunday.',
  },
  {
    value: 'require_mention',
    label: 'Requires @mention',
    hint: 'Only when the message includes an @mention.',
  },
];

function triggerLabel(type: WorkflowTriggerType): string {
  return TRIGGER_OPTIONS.find((item) => item.value === type)?.label ?? type;
}

function actionLabel(type: WorkflowActionType): string {
  return ACTION_OPTIONS.find((item) => item.value === type)?.label ?? type;
}

function conditionLabel(condition: WorkflowCondition): string {
  return CONDITION_OPTIONS.find((item) => item.value === condition)?.label ?? condition;
}

function conditionFromConfig(config: Record<string, unknown>): WorkflowCondition {
  const raw = String(config.condition ?? 'always');
  if (raw === 'weekdays' || raw === 'require_mention') return raw;
  return 'always';
}

function triggerDetail(
  type: WorkflowTriggerType,
  config: Record<string, unknown>,
  keywordFallback = '',
): string {
  if (type === 'message_contains') {
    const keyword = String(config.contains ?? keywordFallback).trim();
    return keyword ? `“${keyword}”` : 'Add a keyword';
  }
  if (type === 'channel_created') return 'New channel';
  return 'Click Run';
}

function actionDetail(
  type: WorkflowActionType,
  config: Record<string, unknown>,
  drafts?: { body?: string; url?: string; delay?: string },
): string {
  if (type === 'post_message') {
    const body = String(config.body ?? drafts?.body ?? '').trim();
    return body ? body.slice(0, 48) : 'Write a message';
  }
  if (type === 'webhook') {
    const url = String(config.url ?? drafts?.url ?? '').trim();
    return url || 'HTTPS endpoint';
  }
  const delay = Number(config.delayMinutes ?? drafts?.delay ?? 60) || 60;
  return `After ${delay}m`;
}

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

function WorkflowMiniGraph({
  triggerType,
  actionType,
  triggerConfig,
  actionConfig,
  compact = false,
}: {
  triggerType: WorkflowTriggerType;
  actionType: WorkflowActionType;
  triggerConfig: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
  compact?: boolean;
}) {
  const condition = conditionFromConfig(triggerConfig);
  return (
    <div className={`workflow-mini-graph${compact ? ' is-compact' : ''}`} aria-hidden="true">
      <div className="workflow-node workflow-node-trigger is-mini">
        <span className="workflow-node-kind">Trigger</span>
        <strong>{triggerLabel(triggerType)}</strong>
        <small>{triggerDetail(triggerType, triggerConfig)}</small>
      </div>
      <svg className="workflow-edge workflow-edge-mini" viewBox="0 0 48 24" width="48" height="24">
        <path
          d="M2 12 H38"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M34 6 L46 12 L34 18 Z" fill="currentColor" />
      </svg>
      <div className="workflow-node workflow-node-condition is-mini">
        <span className="workflow-node-kind">If</span>
        <strong>{conditionLabel(condition)}</strong>
      </div>
      <svg className="workflow-edge workflow-edge-mini" viewBox="0 0 48 24" width="48" height="24">
        <path
          d="M2 12 H38"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M34 6 L46 12 L34 18 Z" fill="currentColor" />
      </svg>
      <div className="workflow-node workflow-node-action is-mini">
        <span className="workflow-node-kind">Action</span>
        <strong>{actionLabel(actionType)}</strong>
        <small>{actionDetail(actionType, actionConfig)}</small>
      </div>
    </div>
  );
}

export function WorkflowsPanel({ conversationId }: { conversationId: string }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>('message_contains');
  const [actionType, setActionType] = useState<WorkflowActionType>('post_message');
  const [condition, setCondition] = useState<WorkflowCondition>('always');
  const [keyword, setKeyword] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [delayMinutes, setDelayMinutes] = useState('60');
  const [focusNode, setFocusNode] = useState<FocusNode>('trigger');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState('');
  const triggerConfigRef = useRef<HTMLDivElement | null>(null);
  const conditionConfigRef = useRef<HTMLDivElement | null>(null);
  const actionConfigRef = useRef<HTMLDivElement | null>(null);

  const triggerHint = useMemo(
    () => TRIGGER_OPTIONS.find((item) => item.value === triggerType)?.hint ?? '',
    [triggerType],
  );
  const conditionHint = useMemo(
    () => CONDITION_OPTIONS.find((item) => item.value === condition)?.hint ?? '',
    [condition],
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

  function selectNode(node: FocusNode) {
    setFocusNode(node);
    const target =
      node === 'trigger'
        ? triggerConfigRef.current
        : node === 'condition'
          ? conditionConfigRef.current
          : actionConfigRef.current;
    window.requestAnimationFrame(() => {
      target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const focusable = target?.querySelector<HTMLElement>(
        'select, input, textarea, button',
      );
      focusable?.focus();
    });
  }

  async function createWorkflow(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const triggerConfig: Record<string, unknown> = { condition };
      if (triggerType === 'message_contains') {
        triggerConfig.contains = keyword.trim();
      }
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
      setCondition('always');
      setFocusNode('trigger');
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
            No-code automations for this channel: connect a trigger to an action.
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

        <div className="workflow-canvas" role="group" aria-label="Workflow graph">
          <button
            type="button"
            className={`workflow-node workflow-node-trigger${
              focusNode === 'trigger' ? ' is-focused' : ''
            }`}
            onClick={() => selectNode('trigger')}
          >
            <span className="workflow-node-kind">1 · Trigger</span>
            <strong>{triggerLabel(triggerType)}</strong>
            <small>
              {triggerDetail(triggerType, { contains: keyword }, keyword)}
            </small>
          </button>

          <svg
            className="workflow-edge"
            viewBox="0 0 80 40"
            width="80"
            height="40"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="workflow-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="4"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
              </marker>
            </defs>
            <path
              d="M4 20 H68"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              markerEnd="url(#workflow-arrow)"
            />
          </svg>

          <button
            type="button"
            className={`workflow-node workflow-node-condition${
              focusNode === 'condition' ? ' is-focused' : ''
            }`}
            onClick={() => selectNode('condition')}
          >
            <span className="workflow-node-kind">2 · Condition</span>
            <strong>{conditionLabel(condition)}</strong>
            <small>{conditionHint}</small>
          </button>

          <svg
            className="workflow-edge"
            viewBox="0 0 80 40"
            width="80"
            height="40"
            aria-hidden="true"
          >
            <path
              d="M4 20 H68"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              markerEnd="url(#workflow-arrow)"
            />
          </svg>

          <button
            type="button"
            className={`workflow-node workflow-node-action${
              focusNode === 'action' ? ' is-focused' : ''
            }`}
            onClick={() => selectNode('action')}
          >
            <span className="workflow-node-kind">3 · Action</span>
            <strong>{actionLabel(actionType)}</strong>
            <small>
              {actionDetail(
                actionType,
                {},
                { body: messageBody, url: webhookUrl, delay: delayMinutes },
              )}
            </small>
          </button>
        </div>

        <div
          ref={triggerConfigRef}
          className={`workflow-node-config${
            focusNode === 'trigger' ? ' is-active' : ''
          }`}
        >
          <label>
            When
            <select
              value={triggerType}
              onFocus={() => setFocusNode('trigger')}
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

          {triggerType === 'message_contains' ? (
            <label>
              Keyword
              <input
                value={keyword}
                onFocus={() => setFocusNode('trigger')}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="e.g. help, deploy, urgent"
                required
                maxLength={200}
              />
            </label>
          ) : null}
        </div>

        <div
          ref={conditionConfigRef}
          className={`workflow-node-config${
            focusNode === 'condition' ? ' is-active' : ''
          }`}
        >
          <label>
            Only if
            <select
              value={condition}
              onFocus={() => setFocusNode('condition')}
              onChange={(event) =>
                setCondition(event.target.value as WorkflowCondition)
              }
            >
              {CONDITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="muted">{conditionHint}</small>
          </label>
        </div>

        <div
          ref={actionConfigRef}
          className={`workflow-node-config${
            focusNode === 'action' ? ' is-active' : ''
          }`}
        >
          <label>
            Then
            <select
              value={actionType}
              onFocus={() => setFocusNode('action')}
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

          {actionType === 'post_message' ? (
            <label>
              Message to post
              <textarea
                value={messageBody}
                onFocus={() => setFocusNode('action')}
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
                onFocus={() => setFocusNode('action')}
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
                onFocus={() => setFocusNode('action')}
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
        </div>

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create workflow'}
        </button>
      </form>

      <ul className="workflow-list">
        {workflows.map((workflow) => (
          <li key={workflow.id} className="workflow-card">
            <div className="workflow-card-main">
              <strong>{workflow.name}</strong>
              <WorkflowMiniGraph
                triggerType={workflow.triggerType}
                actionType={workflow.actionType}
                triggerConfig={workflow.triggerConfig}
                actionConfig={workflow.actionConfig}
                compact
              />
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
