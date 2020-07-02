### Pulse Results Delivery Scripts

These are sample results delivery scripts in various native and third-party interpreters, named by the OS/interpreter used.  They will read the contents of a results file and deliver such to a Pulse webhook endpoint for parsing.

- All delivery scripts will read in ASCII XML and JSON results formats.
- All delivery scripts will Base64 Encode the data for security and prevention of miscoded characters (Sometimes XML doesn't play nice with RESTful JSON payloads).
- The Bash Shell script may have unintended functionality on Mac systems, this is being researched.
