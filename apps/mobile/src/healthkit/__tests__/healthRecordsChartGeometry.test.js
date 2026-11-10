const { execFileSync } = require('node:child_process');

// Exercise the installed library's real scale and label solver in an isolated
// Node process, independent of the chart component mock used by consumer tests.
test('the chart library positions irregular instants and resolves narrow labels', () => {
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const babel = require('@babel/core');
    const root = path.dirname(path.dirname(require.resolve('react-native-chart-kit/v2')));
    const original = require.extensions['.js'];
    require.extensions['.js'] = (module, filename) => {
      if (!filename.startsWith(root + '/dist/v2/')) return original(module, filename);
      const result = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
        filename, babelrc: false, configFile: false,
        presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }]],
      });
      module._compile(result.code, filename);
    };
    const { buildLineChartXScale } = require(path.join(root, 'dist/v2/react-native/charts/line/xScale.js'));
    const { resolveXLabelLayout } = require(path.join(root, 'dist/v2/react-native/charts/line/xLabels.js'));
    const times = [0, 3, 10].map(day => Date.UTC(2026, 9, 1 + day));
    const scale = buildLineChartXScale({ boxes: { plot: { x: 0, width: 100 } }, xValues: times });
    const positions = times.map(scale);
    const candidates = positions.map((x, index) => ({
      index, x, value: times[index], text: String(index), size: { width: 50, height: 12 },
    }));
    const layout = resolveXLabelLayout({ candidates, plotWidth: 100, chartWidth: 138,
      strategy: 'auto', rotation: -35, edgeLabelPolicy: 'shift', minGap: 8, baseY: 0 });
    process.stdout.write(JSON.stringify({ positions, labels: layout.items }));
  `;
  const output = JSON.parse(
    execFileSync(process.execPath, ['-e', script], {
      cwd: require('node:path').resolve(__dirname, '../..', '..'),
      encoding: 'utf8',
    }),
  );
  expect(output.positions).toEqual([0, 30, 100]);
  expect(output.labels.map(label => label.index)).toEqual([0, 2]);
  expect(output.labels.map(label => label.gridX)).toEqual([0, 100]);
  expect(output.labels[0].x + 25 + 8).toBeLessThanOrEqual(
    output.labels[1].x - 25,
  );
});
