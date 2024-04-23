### Pulse Results Delivery Scripts

These is a sample results delivery script in Node.js.  It will read the contents of a results file and deliver it to a Pulse webhook endpoint for parsing.

- All delivery scripts will read in UTF-8 XML and JSON results formats.
- All delivery scripts will Base64 Encode the data for security and prevention of miscoded characters (Sometimes XML doesn't play nice with RESTful JSON payloads).
- These delivery scripts are only compatible with the parsers in this repository.  See 'parsers' subdirectory.
