-- NULL retains the derived owner-offset layout until a position is saved.
ALTER TABLE ports ADD COLUMN pos_x REAL;
ALTER TABLE ports ADD COLUMN pos_y REAL;
