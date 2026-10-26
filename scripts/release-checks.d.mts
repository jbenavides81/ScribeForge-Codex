// Types for release-checks.mjs, for the tests.
export interface ReleaseState {
  version: string;
  changes: string[];
  branch: string;
  tags: string[];
  changelog: string;
  noticesFresh: boolean;
}
export interface Checksum {
  name: string;
  sha256: string;
}
export function releaseFileNames(version: string): { installer: string; sums: string; notes: string };
export function changelogSection(changelog: string, version: string): string | null;
export function refusals(state: ReleaseState): string[];
export function checksumFile(entries: Checksum[]): string;
export function releaseNotes(version: string, section: string, sums: Checksum[]): string;
export function personalDetails(text: string, userName: string): string[];
export function isUpdateFile(name: string): boolean;
