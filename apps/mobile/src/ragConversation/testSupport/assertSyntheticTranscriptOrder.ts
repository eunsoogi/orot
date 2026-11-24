export function assertOrder(tree: string, ...markers: string[]) {
  markers.reduce((previous, marker) => {
    const position = tree.indexOf(marker);
    expect(position).toBeGreaterThan(previous);
    return position;
  }, -1);
}
