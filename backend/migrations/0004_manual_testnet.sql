ALTER TABLE wallet_operations ADD COLUMN manual_phase TEXT CHECK(manual_phase IN ('awaiting_operator','preparing','prepared','submitting','observing'));
ALTER TABLE wallet_operations ADD COLUMN fee_zat INTEGER CHECK(fee_zat>=0);
CREATE UNIQUE INDEX invoice_receiving_address ON records(json_extract(body,'$.payTo'))
 WHERE kind='invoice' AND json_extract(body,'$.network')='testnet';
