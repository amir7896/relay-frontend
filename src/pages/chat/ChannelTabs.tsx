import type { Conversation } from '../../api/types';
import { AppsPanel } from './tabs/AppsPanel';
import { CanvasPanel } from './tabs/CanvasPanel';
import { ClipsPanel } from './tabs/ClipsPanel';
import { ConnectPanel } from './tabs/ConnectPanel';
import { ListsPanel } from './tabs/ListsPanel';
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
  onOpenFiles: () => void;
  onOpenPins: () => void;
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
  onOpenFiles,
  onOpenPins,
}: Props) {
  function selectTab(tab: ChannelTab) {
    if (tab === 'files') {
      onOpenFiles();
      return;
    }
    if (tab === 'pins') {
      onOpenPins();
      return;
    }
    onTabChange(tab);
  }

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
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {activeTab !== 'messages' &&
      activeTab !== 'files' &&
      activeTab !== 'pins' ? (
        <div className="channel-tab-panel" role="tabpanel">
          {activeTab === 'canvas' ? <CanvasPanel conversationId={conversationId} /> : null}
          {activeTab === 'lists' ? <ListsPanel conversationId={conversationId} /> : null}
          {activeTab === 'clips' ? <ClipsPanel conversationId={conversationId} /> : null}
          {activeTab === 'workflows' ? (
            <WorkflowsPanel conversationId={conversationId} />
          ) : null}
          {activeTab === 'apps' ? <AppsPanel /> : null}
          {activeTab === 'connect' ? (
            <ConnectPanel conversationId={conversationId} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
