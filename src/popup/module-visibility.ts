import type { Prefs } from '../core/storage';
import type { GrandloadModule, PageContext } from '../core/types';

export function getVisibleModules(
  modules: readonly GrandloadModule[],
  context: PageContext,
  prefs: Prefs,
): GrandloadModule[] {
  return modules.filter((module) => {
    if (module.id !== 'preferences' && !module.canHandle(context)) {
      return false;
    }
    return module.id === 'preferences' || prefs.modulesEnabled[module.id] !== false;
  });
}
