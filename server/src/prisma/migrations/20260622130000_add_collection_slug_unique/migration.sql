-- AddUniqueConstraint
ALTER TABLE "collections" ADD CONSTRAINT "collections_slug_key" UNIQUE ("slug");
