-- Categories/brands/tags become soft-deletable so device sync tombstones
-- (deletedAt) can propagate a deletion to other devices' local collections.
ALTER TABLE "collections" ADD COLUMN "deletedAt" TIMESTAMP(3);
