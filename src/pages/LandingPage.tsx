import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

export function LandingPage() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      return;
    }
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  return (
    <main className="landing">
      <section className="hero landing-wrap">
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Private team messenger</p>
            <h1>
              Talk to your team
              <em> with enterprise-grade chat.</em>
            </h1>
            <p className="hero-copy">
              Relay combines WhatsApp-level messaging — reactions, voice notes,
              @mentions, and AI summaries — with a NestJS microservices backend
              buyers can trust.
            </p>
            <div className="hero-actions">
              <Link className="btn lg" to="/register">
                Get started
              </Link>
              <Link className="btn ghost lg" to="/login">
                I already have an account
              </Link>
            </div>
          </div>
          <MessengerPreview />
        </div>
      </section>

      <section className="stack-strip" aria-label="What you can do">
        <div className="landing-wrap stack-strip-inner">
          <span>Reactions & replies</span>
          <span>Edit & forward</span>
          <span>Voice notes</span>
          <span>Global search</span>
          <span>Installable PWA</span>
          <span>Admin analytics</span>
        </div>
      </section>

      <section className="landing-section landing-wrap" id="product">
        <header className="section-head">
          <p className="eyebrow">Product</p>
          <h2>A messenger that stays out of the way.</h2>
          <p className="section-lead">
            Conversations, people, and presence live in one place. You open a
            thread, talk, and leave. Nothing else competes for attention.
          </p>
        </header>
        <div className="features">
          <article>
            <h3>Rich messaging</h3>
            <p>
              Reactions, reply quotes, edit within 15 minutes, forward, delete
              for me or everyone, images, and voice notes.
            </p>
          </article>
          <article>
            <h3>Search & previews</h3>
            <p>
              Find any message inside a thread. Paste a link and Relay fetches a
              rich preview card automatically.
            </p>
          </article>
          <article>
            <h3>Groups & @mentions</h3>
            <p>
              Named groups with admin roles, member management, and @mentions
              that highlight the right people.
            </p>
          </article>
          <article>
            <h3>AI assist</h3>
            <p>
              Smart reply chips under the composer and one-click thread
              summaries powered by OpenAI (optional).
            </p>
          </article>
          <article>
            <h3>Admin analytics</h3>
            <p>
              Live online count, message charts, top conversations, audit log,
              and CSV export for compliance demos.
            </p>
          </article>
          <article>
            <h3>White-label ready</h3>
            <p>
              Change app name, tagline, and accent color from Profile. One
              Docker command starts the full stack.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-band" id="how">
        <div className="landing-wrap">
          <header className="section-head">
            <p className="eyebrow">How it works</p>
            <h2>Three steps from empty inbox to a live thread.</h2>
          </header>
          <ol className="steps">
            <li>
              <span>01</span>
              <h3>Create an account</h3>
              <p>Join with your name and email. You land in your own workspace.</p>
            </li>
            <li>
              <span>02</span>
              <h3>Open a conversation</h3>
              <p>Message someone directly, or start a group with a name and members.</p>
            </li>
            <li>
              <span>03</span>
              <h3>Talk in the moment</h3>
              <p>Typing, seen receipts, and presence update while you stay in the thread.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="landing-section landing-wrap" id="teams">
        <header className="section-head">
          <p className="eyebrow">Who it is for</p>
          <h2>Built for teams that want a quiet room, not another feed.</h2>
          <p className="section-lead">
            Relay is for people who already work together and need a private
            place to talk — not for broadcasting to the internet.
          </p>
        </header>
        <div className="arch-grid">
          <article>
            <h3>Product teams</h3>
            <p>Keep launch talk, decisions, and follow-ups in one thread.</p>
          </article>
          <article>
            <h3>Operations</h3>
            <p>A calm channel for the people who keep the day moving.</p>
          </article>
          <article>
            <h3>Small companies</h3>
            <p>A workspace messenger without a public square or extra apps.</p>
          </article>
          <article>
            <h3>Admins</h3>
            <p>A people directory so membership stays clear and manageable.</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-wrap" id="faq">
        <header className="section-head">
          <p className="eyebrow">FAQ</p>
          <h2>Straight answers before you sign in.</h2>
        </header>
        <div className="faq">
          <details open>
            <summary>Is Relay a public chat network?</summary>
            <p>
              No. It is a private messenger for your team. Only people with an
              account in your workspace can talk here.
            </p>
          </details>
          <details>
            <summary>What can I do after I sign in?</summary>
            <p>
              Direct and group chat with reactions, reply, edit, forward, voice
              notes, @mentions, link previews, smart replies, and AI thread
              summaries. Admins also get analytics and audit export.
            </p>
          </details>
          <details>
            <summary>Who can manage other people?</summary>
            <p>
              Admins can use the People directory. Everyone else manages their
              own profile and conversations.
            </p>
          </details>
          <details>
            <summary>Does it work in light and dark mode?</summary>
            <p>
              Yes. Use the sun or moon control in the header. The choice is
              saved on this browser.
            </p>
          </details>
        </div>
      </section>

      <section className="cta-band">
        <div className="landing-wrap cta-band-inner">
          <div>
            <p className="eyebrow">Ready when you are</p>
            <h2>Open a thread. Leave the noise behind.</h2>
          </div>
          <div className="hero-actions">
            <Link className="btn lg" to="/register">
              Create account
            </Link>
            <Link className="btn ghost lg" to="/login">
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function MessengerPreview() {
  return (
    <div className="hero-preview" aria-hidden="true">
      <div className="preview-window">
        <div className="preview-chrome">
          <span />
          <span />
          <span />
          <strong>Relay</strong>
        </div>
        <div className="preview-body">
          <aside>
            <p>Messages</p>
            <div className="preview-row active">
              <span className="avatar sm">AL</span>
              <div>
                <strong>Alex</strong>
                <small>Ship notes in the group</small>
              </div>
            </div>
            <div className="preview-row">
              <span className="avatar sm">SK</span>
              <div>
                <strong>Samir</strong>
                <small>Seen just now</small>
              </div>
            </div>
            <div className="preview-row">
              <span className="avatar sm">NO</span>
              <div>
                <strong>Nova</strong>
                <small>Typing…</small>
              </div>
            </div>
          </aside>
          <div className="preview-thread">
            <div className="bubble">Can we keep launch chat in one thread?</div>
            <div className="bubble mine">Already on it — group is live.</div>
            <div className="bubble">Green is on. I am here.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
