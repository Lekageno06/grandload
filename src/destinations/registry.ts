import type { DestinationWriter } from './types';

const destinations = new Map<string, DestinationWriter>();

export function registerDestination(writer: DestinationWriter): DestinationWriter {
  destinations.set(writer.id, writer);
  return writer;
}

export function getDestination(id: string): DestinationWriter | undefined {
  return destinations.get(id);
}

export function listDestinations(): DestinationWriter[] {
  return Array.from(destinations.values());
}
