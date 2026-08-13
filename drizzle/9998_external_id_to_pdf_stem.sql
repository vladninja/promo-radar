-- Discovery moved from the media REST endpoint to the shop listing pages, so a
-- leaflet is now keyed by its PDF file stem instead of a media attachment id.
-- Re-key existing rows from their stored pdf_url, otherwise every leaflet would
-- look new and be downloaded and parsed again.
update leaflets
   set external_id = regexp_replace(pdf_url, '^.*/([^/]+)\.pdf$', '\1')
 where external_id !~ '__';
