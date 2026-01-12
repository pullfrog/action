import { Timer } from './timer.ts';
import * as cli from './cli.ts';

describe('Timer', () => {
  beforeEach(() => {
    vi.spyOn(cli.log, 'debug');
    // Mock Date.now to have predictable timestamps
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with current timestamp', () => {
      const mockTime = 1000000;
      vi.setSystemTime(mockTime);

      const timer = new Timer();
      timer.checkpoint('test');

      expect(cli.log.debug).toHaveBeenCalledWith(
        expect.stringContaining('test')
      );
    });
  });

  describe('checkpoint', () => {
    it('should log duration from initial timestamp on first checkpoint', () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      const checkpointTime = startTime + 100;
      vi.setSystemTime(checkpointTime);
      timer.checkpoint('first');

      expect(cli.log.debug).toHaveBeenCalledWith('» first: 100ms');
    });

    it('should log duration from last checkpoint on subsequent checkpoints', () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      // First checkpoint
      const firstCheckpointTime = startTime + 50;
      vi.setSystemTime(firstCheckpointTime);
      timer.checkpoint('first');

      // Second checkpoint
      const secondCheckpointTime = firstCheckpointTime + 75;
      vi.setSystemTime(secondCheckpointTime);
      timer.checkpoint('second');

      expect(cli.log.debug).toHaveBeenCalledTimes(2);
      expect(cli.log.debug).toHaveBeenNthCalledWith(1, '» first: 50ms');
      expect(cli.log.debug).toHaveBeenNthCalledWith(2, '» second: 75ms');
    });

    it('should handle multiple checkpoints correctly', () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      // First checkpoint
      vi.setSystemTime(startTime + 10);
      timer.checkpoint('step1');

      // Second checkpoint
      vi.setSystemTime(startTime + 25);
      timer.checkpoint('step2');

      // Third checkpoint
      vi.setSystemTime(startTime + 45);
      timer.checkpoint('step3');

      expect(cli.log.debug).toHaveBeenCalledTimes(3);
      expect(cli.log.debug).toHaveBeenNthCalledWith(1, '» step1: 10ms');
      expect(cli.log.debug).toHaveBeenNthCalledWith(2, '» step2: 15ms');
      expect(cli.log.debug).toHaveBeenNthCalledWith(3, '» step3: 20ms');
    });

    it('should handle zero duration correctly', () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      // Checkpoint immediately
      timer.checkpoint('immediate');

      expect(cli.log.debug).toHaveBeenCalledWith('» immediate: 0ms');
    });

    it('should handle custom checkpoint names', () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      vi.setSystemTime(startTime + 200);
      timer.checkpoint('Custom Checkpoint Name');

      expect(cli.log.debug).toHaveBeenCalledWith(
        '» Custom Checkpoint Name: 200ms'
      );
    });
  });
});
