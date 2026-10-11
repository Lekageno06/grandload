import type {
  GrandloadModule,
  Packager,
  SiteAdapter,
} from './types';

const modules = new Map<string, GrandloadModule>();
const adapters = new Map<string, SiteAdapter>();
const packagers = new Map<string, Packager>();

export function registerModule(module: GrandloadModule): GrandloadModule {
  modules.set(module.id, module);
  return module;
}

export function getModule(moduleId: string): GrandloadModule | undefined {
  return modules.get(moduleId);
}

export function listModules(): GrandloadModule[] {
  return Array.from(modules.values()).sort((left, right) => right.priority - left.priority);
}

export function registerAdapter(adapter: SiteAdapter): SiteAdapter {
  adapters.set(adapter.id, adapter);
  return adapter;
}

export function getAdapter(adapterId: string): SiteAdapter | undefined {
  return adapters.get(adapterId);
}

export function listAdapters(): SiteAdapter[] {
  return Array.from(adapters.values());
}

export function registerPackager(packager: Packager): Packager {
  packagers.set(packager.id, packager);
  return packager;
}

export function getPackager(packagerId: string): Packager | undefined {
  return packagers.get(packagerId);
}

export function listPackagers(): Packager[] {
  return Array.from(packagers.values());
}
