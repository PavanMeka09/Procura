'use client';

import React, { useState } from 'react';
import { IntakeForm } from '../components/intake/IntakeForm';
import { ControlRoom } from '../components/workspace/ControlRoom';

/**
 * Root Application Entry:
 * Toggles between the Procurement Intake screen and the Live Control Room workspace.
 */
export default function Home() {
  const [activeWorkspace, setActiveWorkspace] = useState(null);

  if (!activeWorkspace) {
    return (
      <IntakeForm
        onStart={(request, session) =>
          setActiveWorkspace({ request, session })
        }
      />
    );
  }

  return (
    <ControlRoom
      initialSession={activeWorkspace.session}
      onNew={() => setActiveWorkspace(null)}
    />
  );
}
