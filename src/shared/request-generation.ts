export class LatestRequestGate {
  private generation = 0;
  begin(): number { return ++this.generation; }
  invalidate(): void { this.generation++; }
  isLatest(token: number): boolean { return token === this.generation; }
}
