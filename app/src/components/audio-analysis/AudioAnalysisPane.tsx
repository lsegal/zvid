import type { MasterMeterTap } from "../../fx-shaders/audio-bands";
import { VuMeter } from "../timeline/VuMeter";
import { Spectrogram } from "./Spectrogram";
import "./audio-analysis-pane.css";

type AudioAnalysisPaneProps = {
  isPlaying: boolean;
  getMeterTap: () => MasterMeterTap | null;
};

// The preview's audio analysis area, shown by the Audio toggle in its
// header: a spectrogram of the program mix, with a vertical master VU meter
// at its right edge.
export function AudioAnalysisPane({
  isPlaying,
  getMeterTap,
}: AudioAnalysisPaneProps) {
  return (
    <section className="audio-analysis" aria-label="Audio analysis">
      <Spectrogram isPlaying={isPlaying} getMeterTap={getMeterTap} />
      <div className="audio-analysis__meter">
        <VuMeter
          isPlaying={isPlaying}
          getMeterTap={getMeterTap}
          orientation="vertical"
        />
      </div>
    </section>
  );
}
