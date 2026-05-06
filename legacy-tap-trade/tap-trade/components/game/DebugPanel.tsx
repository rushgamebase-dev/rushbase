"use client";

import { useState } from "react";
import { UI_CONFIG } from "@/lib/ui-config";
import { Settings, X, ChevronDown, ChevronUp } from "lucide-react";

interface DebugPanelProps {
  onConfigChange: (key: string, value: number | string) => void;
  config: typeof UI_CONFIG;
}

export function DebugPanel({ onConfigChange, config }: DebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>("grid");

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-20 right-4 z-50 p-2 rounded bg-purple-900/80 hover:bg-purple-800 transition-colors"
        title="Debug Mode"
      >
        <Settings size={20} color="white" />
      </button>
    );
  }

  const Section = ({
    title,
    id,
    children,
  }: {
    title: string;
    id: string;
    children: React.ReactNode;
  }) => (
    <div className="border-b border-purple-700/50">
      <button
        onClick={() => setExpandedSection(expandedSection === id ? null : id)}
        className="w-full flex items-center justify-between p-2 hover:bg-purple-800/30"
      >
        <span className="text-sm font-medium text-white">{title}</span>
        {expandedSection === id ? (
          <ChevronUp size={16} className="text-gray-400" />
        ) : (
          <ChevronDown size={16} className="text-gray-400" />
        )}
      </button>
      {expandedSection === id && <div className="p-2 space-y-2">{children}</div>}
    </div>
  );

  const Slider = ({
    label,
    value,
    min,
    max,
    step = 1,
    onChange,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (v: number) => void;
  }) => (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-mono">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-purple-500"
      />
    </div>
  );

  const ColorInput = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer"
      />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );

  return (
    <div className="fixed top-4 right-4 z-50 w-72 bg-purple-950/95 border border-purple-700 rounded-lg shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-purple-700">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Settings size={16} />
          Debug Mode
        </h3>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-purple-800 rounded"
        >
          <X size={16} className="text-gray-400" />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-[70vh] overflow-y-auto">
        <Section title="Grid" id="grid">
          <Slider
            label="Cell Width"
            value={config.grid.cellWidth}
            min={30}
            max={100}
            onChange={(v) => onConfigChange("grid.cellWidth", v)}
          />
          <Slider
            label="Cell Height"
            value={config.grid.cellHeight}
            min={20}
            max={60}
            onChange={(v) => onConfigChange("grid.cellHeight", v)}
          />
          <Slider
            label="Line Width"
            value={config.grid.lineWidth}
            min={1}
            max={4}
            onChange={(v) => onConfigChange("grid.lineWidth", v)}
          />
          <Slider
            label="Columns"
            value={config.grid.columns}
            min={6}
            max={20}
            onChange={(v) => onConfigChange("grid.columns", v)}
          />
          <Slider
            label="Rows"
            value={config.grid.rows}
            min={6}
            max={20}
            onChange={(v) => onConfigChange("grid.rows", v)}
          />
        </Section>

        <Section title="Colors" id="colors">
          <ColorInput
            label="Background"
            value={config.colors.bgPrimary}
            onChange={(v) => onConfigChange("colors.bgPrimary", v)}
          />
          <ColorInput
            label="Grid Lines"
            value={config.colors.gridLine}
            onChange={(v) => onConfigChange("colors.gridLine", v)}
          />
          <ColorInput
            label="Tile Yellow"
            value={config.colors.tileYellow}
            onChange={(v) => onConfigChange("colors.tileYellow", v)}
          />
          <ColorInput
            label="Chart Line"
            value={config.colors.chartLine}
            onChange={(v) => onConfigChange("colors.chartLine", v)}
          />
          <ColorInput
            label="Price Tag"
            value={config.colors.priceTag}
            onChange={(v) => onConfigChange("colors.priceTag", v)}
          />
        </Section>

        <Section title="Typography" id="typography">
          <Slider
            label="Multiplier Size"
            value={parseInt(config.typography.multiplierSize)}
            min={8}
            max={16}
            onChange={(v) => onConfigChange("typography.multiplierSize", `${v}px`)}
          />
          <Slider
            label="Tile Value Size"
            value={parseInt(config.typography.tileValueSize)}
            min={10}
            max={20}
            onChange={(v) => onConfigChange("typography.tileValueSize", `${v}px`)}
          />
        </Section>

        <Section title="Tiles" id="tiles">
          <Slider
            label="Border Radius"
            value={config.tiles.borderRadius}
            min={0}
            max={12}
            onChange={(v) => onConfigChange("tiles.borderRadius", v)}
          />
          <Slider
            label="Border Width"
            value={config.tiles.borderWidth}
            min={0}
            max={4}
            onChange={(v) => onConfigChange("tiles.borderWidth", v)}
          />
        </Section>

        <Section title="Chart" id="chart">
          <Slider
            label="Chart Width"
            value={config.chart.width}
            min={150}
            max={400}
            step={10}
            onChange={(v) => onConfigChange("chart.width", v)}
          />
          <Slider
            label="Line Width"
            value={config.chart.lineWidth}
            min={1}
            max={5}
            onChange={(v) => onConfigChange("chart.lineWidth", v)}
          />
        </Section>

        <Section title="Animations" id="animations">
          <Slider
            label="Hover Duration (ms)"
            value={config.animations.hoverDuration}
            min={50}
            max={300}
            step={10}
            onChange={(v) => onConfigChange("animations.hoverDuration", v)}
          />
          <Slider
            label="Invalid Flash (ms)"
            value={config.animations.invalidFlashDuration}
            min={100}
            max={500}
            step={50}
            onChange={(v) => onConfigChange("animations.invalidFlashDuration", v)}
          />
        </Section>
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-purple-700 text-center">
        <span className="text-xs text-gray-500">
          Press Ctrl+Shift+D to toggle
        </span>
      </div>
    </div>
  );
}
