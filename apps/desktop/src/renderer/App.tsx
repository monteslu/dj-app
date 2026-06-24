/**
 * App — the top-level layout. Two decks flanking a center mixer, Mixxx's classic
 * arrangement (02-functional-spec.md §1). A start gate handles the AudioContext
 * autoplay policy (needs a user gesture).
 */

import { useState } from 'react';
import { DjProvider, useDj, NUM_DECKS } from './dj-context.js';
import { Deck } from './components/Deck.js';
import { Mixer } from './components/Mixer.js';
import { Library } from './components/Library.js';
import { AudioSettings } from './components/AudioSettings.js';

function RecordButton(): React.JSX.Element {
  const { recording, started, start } = useDj();
  const [rec, setRec] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    if (!started) {
      await start();
    }
    if (rec) {
      setSaving(true);
      try {
        await recording.stopAndSave();
      } finally {
        setRec(false);
        setSaving(false);
      }
    } else {
      await recording.start();
      setRec(true);
    }
  };

  return (
    <button
      className={`tiny record-btn ${rec ? 'recording' : ''}`}
      onClick={() => void toggle()}
      disabled={saving}
      title="Record the master mix to a WAV file"
    >
      {saving ? 'saving…' : rec ? '⏹ stop rec' : '⏺ record'}
    </button>
  );
}

function Stage(): React.JSX.Element {
  const { started, start } = useDj();
  const [showAudio, setShowAudio] = useState(false);

  return (
    <div className="app">
      <div className="titlebar">
        <span className="brand">dj-app</span>
        <span className="tagline">built for the love of it</span>
        <RecordButton />
        <button className="tiny audio-routing-btn" onClick={() => setShowAudio(true)}>
          🔊 audio routing
        </button>
        {!started && (
          <button className="start-audio" onClick={() => void start()}>
            ▶ start audio
          </button>
        )}
      </div>
      {showAudio && <AudioSettings onClose={() => setShowAudio(false)} />}
      <main className="decks">
        <Deck deckIndex={0} />
        <Mixer />
        <Deck deckIndex={1} />
      </main>
      <Library />
      <footer className="statusbar">
        <span>{NUM_DECKS} decks</span>
        <span>{started ? 'audio running' : 'audio idle — click start or load a track'}</span>
      </footer>
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <DjProvider>
      <Stage />
    </DjProvider>
  );
}
