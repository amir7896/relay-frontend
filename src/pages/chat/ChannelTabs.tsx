import type { ChatMessage, Conversation } from '../../api/types';
import { AppsPanel } from './tabs/AppsPanel';
import { CanvasPanel } from './tabs/CanvasPanel';
import { ClipsPanel } from './tabs/ClipsPanel';
import { ConnectPanel } from './tabs/ConnectPanel';
import { FilesPanel, type MediaKindTab } from './tabs/FilesPanel';
import { ListsPanel } from './tabs/ListsPanel';
import { PinsPanel } from './tabs/PinsPanel';
import { WorkflowsPanel } from './tabs/WorkflowsPanel';

export type ChannelTab =
  | 'messages'
  | 'files'
  | 'pins'
  | 'canvas'
  | 'lists'
  | 'clips'
  | 'workflows'
  | 'apps'
  | 'connect';

type Props = {
  conversationId: string;
  conversation: Conversation;
  activeTab: ChannelTab;
  onTabChange: (tab: ChannelTab) => void;
  filesInitialKind?: MediaKindTab;
  onJumpToMessage?: (messageId: string) => void;
  onPinsChanged?: (items: ChatMessage[]) => void;
};

const TABS: Array<{ id: ChannelTab; label: string; groupsOnly?: boolean }> = [
  { id: 'messages', label: 'Messages' },
  { id: 'files', label: 'Files' },
  { id: 'pins', label: 'Pins' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'lists', label: 'Lists' },
  { id: 'clips', label: 'Clips' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'apps', label: 'Apps' },
  { id: 'connect', label: 'Connect', groupsOnly: true },
];

export function ChannelTabs({
  conversationId,
  conversation,
  activeTab,
  onTabChange,
  filesInitialKind = 'all',
  onJumpToMessage,
  onPinsChanged,
}: Props) {
  const visibleTabs = TABS.filter(
    (tab) => !tab.groupsOnly || conversation.type === 'group',
  );

  return (
    <>
      <nav className="channel-tabs" role="tablist" aria-label="Channel tabs">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`channel-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {activeTab !== 'messages' ? (
        <div
          className={`channel-tab-panel${
            activeTab === 'lists' ? ' is-lists' : ''
          }${activeTab === 'apps' ? ' is-apps' : ''}${
            activeTab === 'files' ? ' is-files' : ''
          }${activeTab === 'pins' ? ' is-pins' : ''}`}
          role="tabpanel"
        >
          {activeTab === 'files' ? (
            <FilesPanel
              conversationId={conversationId}
              initialKind={filesInitialKind}
              onJumpToMessage={onJumpToMessage}
            />
          ) : null}
          {activeTab === 'pins' ? (
            <PinsPanel
              conversationId={conversationId}
              onJumpToMessage={onJumpToMessage}
              onPinsChanged={onPinsChanged}
            />
          ) : null}
          {activeTab === 'canvas' ? (
            <CanvasPanel conversationId={conversationId} />
          ) : null}
          {activeTab === 'lists' ? (
            <ListsPanel
              conversationId={conversationId}
              conversation={conversation}
            />
          ) : null}
          {activeTab === 'clips' ? (
            <ClipsPanel conversationId={conversationId} />
          ) : null}
          {activeTab === 'workflows' ? (
            <WorkflowsPanel conversationId={conversationId} />
          ) : null}
          {activeTab === 'apps' ? (
            <AppsPanel
              conversationId={conversationId}
              onTrySlashCommand={(commandName) => {
                onTabChange('messages');
                window.setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent('relay:composer-slash', {
                      detail: { command: commandName },
                    }),
                  );
                }, 80);
              }}
            />
          ) : null}
          {activeTab === 'connect' ? (
            <ConnectPanel conversationId={conversationId} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
