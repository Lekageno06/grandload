import { describe, expect, it } from 'vitest';

import { getModule, listModules, registerModule } from '../src/core/registry';
import type { GrandloadModule } from '../src/core/types';

describe('registry', () => {
  it('registers and lists modules by priority', () => {
    const firstModule: GrandloadModule = {
      id: 'module-a',
      title: 'Module A',
      priority: 10,
      canHandle: () => true,
      mountPanel: () => undefined,
    };

    const secondModule: GrandloadModule = {
      id: 'module-b',
      title: 'Module B',
      priority: 25,
      canHandle: () => true,
      mountPanel: () => undefined,
    };

    registerModule(firstModule);
    registerModule(secondModule);

    expect(getModule('module-a')).toEqual(firstModule);
    expect(listModules().map((module) => module.id)).toEqual(['module-b', 'module-a']);
  });
});
