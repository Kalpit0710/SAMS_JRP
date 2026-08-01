Product Requirements Document (PRD)
School Attendance Management System (SAMS)

Project Name: J. R. Preparatory School Attendance Management System

Version: 2.0 (supersedes 1.0)

Prepared For: J. R. Preparatory School

Document Type: Product Requirements Document (PRD)

Database: MongoDB

Platform: Responsive Web Application

Primary Users: Teachers, School Administration

Primary Device: Mobile Browser/Tablet

Secondary Device: Desktop/Laptop Browser

---

## 0. Current Implemented Scope (v2.0 — authoritative)

> This section reflects the system as actually built and is the acceptance baseline.
> Sections 1 onward are the original v1.0 vision, retained for history; where they
> conflict with this section, this section wins.

### 0.1 Roles (exactly two)

- **Admin** — full access: master data (classes, teachers, students) CRUD, attendance
  create/edit anytime, all reports and analytics, CSV import/export, attendance-lock
  configuration, notification generation, audit logs, own-PIN change.
- **Teacher** — scoped to their single assigned class only (enforced server-side):
  mark and edit attendance within the lock window, view their class reports and alerts,
  change their own PIN. No master-data writes, import/export, or audit access.

Removed from scope: Super Admin, Office Staff, and Parent roles/portal.

### 0.2 Data model

- **Class** = name (unique) + isActive. No sections, no per-class academic session
  (session is school-wide configuration).
- **Student** = regNo (unique), fullName, classId, rollNumber, dob, fatherName,
  motherName, phoneNumber, status. Parent contact lives inline on the student; there is
  no separate Parent collection.
- **Teacher** = userId, fullName, single classId, phoneNumber, isActive.
- **Attendance** = one record per (classId, date); entries hold student status
  (present / absent / late / half_day). Submitted records are the historical snapshot
  and are not recomputed against the current roster.

Removed: sections, separate parent records, and the leave statuses.

### 0.3 Key workflows

- Attendance board: pick class + date, load any existing record, mark or correct every
  student, confirm a physical head-count, then submit (create) or update (edit) subject
  to the lock policy.
- Absence alerts: generated as ready-to-send WhatsApp (wa.me) links to the parent phone
  stored on the student. No paid/integrated WhatsApp API is in scope.
- Reports: daily/class analytics plus **CSV and PDF** export (not Excel).
- Bulk data: **CSV** import/export with preview and validation (not Excel/.xlsx).
- Bilingual UI: English and Hindi.

### 0.4 Excluded

Fee/exam/homework management, online classes, SMS/email notifications, automated
WhatsApp chatbot, and native mobile apps.

---

1. Introduction
1.1 Purpose

The School Attendance Management System (SAMS) is a secure, mobile-first web application designed to digitize the attendance process for J. R. Preparatory School.

The system replaces manual attendance registers with a centralized platform that allows:

Teachers to mark attendance quickly.
Parents to receive instant absence notifications.
School administrators to monitor attendance across the school.
Office staff to generate reports and assist administration.
School management to configure every aspect of attendance.

The system emphasizes simplicity, reliability, security, and ease of use for users with limited technical experience.

2. Goals

The system should:

Allow teachers to complete attendance within 2–3 minutes.
Notify parents immediately when a student is absent via WhatsApp.
Provide detailed attendance analytics.
Minimize administrative work.
Eliminate manual attendance registers.
Maintain complete audit logs.
Ensure secure access to all school data.
Support bilingual usage (English and Hindi).
3. Scope

The project includes:

Student Attendance
Student Management
Parent Management
Teacher Management
Class Management
Analytics
Reports
Notifications
User Management
System Configuration
Excel Import/Export
Role-Based Access Control
Audit Logs

The project excludes:

Fee Management
Online Classes
Homework Management
Exam Management
SMS Notifications
Email Notifications
Automatic WhatsApp Chatbot
Mobile Applications (Android/iOS)
4. User Roles
4.1 Super Admin

Highest level access.

Responsibilities:

Complete system ownership
Configure every module
Manage permissions
Configure attendance rules
Configure notification settings
Manage academic sessions
Database backup & restore
View complete audit logs
Manage all users
Configure school branding
Configure language settings
Configure security settings
4.2 Admin

School Administrator.

Permissions:

CRUD Students
CRUD Teachers
CRUD Parents
CRUD Classes
CRUD Sections
CRUD Attendance
Edit attendance anytime
View all reports
View all analytics
Configure attendance timing
Upload Excel
Download Excel
Send announcements

Cannot modify Super Admin settings.

4.3 Office Staff

Designed for receptionists and office staff.

Can:

View students
View teachers
View attendance
Search students
Print reports
Download reports
Export attendance
Resend WhatsApp notifications
View parent contact details
Generate attendance certificates

Cannot:

Edit attendance
Change settings
Delete records
Create administrators
4.4 Teacher

Can access only assigned classes.

Can:

Mark attendance
Edit attendance within allowed time
View assigned students
View class analytics
View reports
Search students

Cannot:

Delete attendance
Access other classes
Change settings
4.5 Parent

Can access only their child/children.

Can:

View attendance
View attendance history
View analytics
View announcements
Receive notifications

Cannot:

Edit attendance
Mark attendance
Approve attendance
5. User Authentication

Authentication methods:

Username & Password
Mobile Number & Password (optional)

Security Features:

JWT Authentication
Refresh Tokens
Password Hashing (bcrypt)
Secure Cookies
Session Timeout
Device Tracking
Login History
Automatic Logout
Brute Force Protection
Password Complexity Rules
6. Dashboard
Teacher Dashboard

Display:

Today's Attendance Status
Total Students
Present
Absent
Late
Attendance Percentage
Pending Attendance
Quick Attendance Button
Recent Notifications
Class Performance
Parent Dashboard

Display:

Child Attendance Today
Attendance Percentage
Monthly Calendar
Recent Notifications
School Announcements
Attendance Graph
Office Dashboard

Display:

Today's Attendance Summary
Student Search
Pending Reports
Quick Report Generation
Admin Dashboard

Display:

School Attendance %
Today's Attendance
Absent Students
Present Students
Class-wise Attendance
Teacher-wise Attendance
Monthly Trend
Yearly Trend
Attendance Heatmap
Notifications Sent
Pending Attendance
System Activity
7. Student Management

Fields:

Admission Number

Student Name

Photo

Gender

Date of Birth

Class

Section

Roll Number

Parent Name

Father Name

Mother Name

Phone Number

Address

Blood Group

Medical Notes

Admission Date

Status

House

Transport Route

8. Teacher Management

Fields:

Employee ID

Name

Photo

Phone

Email

Qualification

Assigned Classes

Subjects

Joining Date

Status

9. Parent Management

One parent account can be linked to multiple children.

Fields:

Parent Name

Phone Number

Alternative Number

Email

Address

Relationship

Linked Students

10. Attendance Module

Teacher selects:

Class

↓

Section

↓

Student List

Attendance options:

✅ Present

❌ Absent

🕒 Late

Half Day

Quick Actions:

Mark All Present

Search Student

Filter Students

Undo Last Action

Save Draft

Submit Attendance

11. Attendance Lock Policy

Default:

Teachers can edit attendance within 1 Hour.

Configurable by Admin.

Possible values:

15 Minutes
30 Minutes
1 Hour
2 Hours
6 Hours
12 Hours
24 Hours
Never Lock

Admin can edit attendance anytime.

Every edit creates an Audit Log.

12. Parent Notification Flow

Teacher submits attendance

↓

System identifies absentees

↓

Personalized WhatsApp message sent

Example:

Dear Parent,

Your child Rahul Sharma (Class 4-A) has been marked absent today.

If applicable, kindly reply to this WhatsApp message with the reason.

Regards,
J. R. Preparatory School

Replies are handled manually by school staff through WhatsApp Business.

The system does not read incoming WhatsApp messages.

13. Notification System

Supported:

In-Web Notifications
WhatsApp Notifications

Not Supported:

SMS
Email

Notification Types:

Attendance

Announcements

Holidays

Events

System Alerts

14. Reports

Daily Attendance

Weekly Attendance

Monthly Attendance

Yearly Attendance

Class Report

Section Report

Teacher Report

Student Report

Custom Report

Exports:

Excel

CSV

PDF

Print

15. Analytics
Teacher

Attendance %

Late Students

Monthly Trend

Student Comparison

Daily Summary

Weekly Summary

Parent

Monthly %

Yearly %

Attendance Calendar

Present Count

Absent Count

Late Count

Attendance Trend

Admin

School Attendance

Teacher Comparison

Class Comparison

Section Comparison

Student Comparison

Date Range Filters

Academic Session Filters

Attendance Heatmaps

Low Attendance Alerts

Top Performing Classes

Export Analytics

16. Excel Import / Export

Admin Only

Import:

Students

Teachers

Parents

Attendance

Classes

Sections

Export:

Entire Database

Selected Records

Date Range

Student List

Teacher List

Attendance

Features:

Download Templates

Duplicate Detection

Validation

Preview Before Import

Rollback on Failure

Import Log

17. Settings Module

School Information

Academic Session

Working Days

Attendance Lock Time

Late Time

Half-Day Time

School Logo

School Name

Primary Color

Theme

Language

Holiday Calendar

Notification Templates

WhatsApp Configuration

Backup Schedule

18. Language Support

Supported Languages:

English

Hindi

Every page must support both languages.

Language selection available from profile.

Remember last selected language.

Admin can define default language.

19. UI Requirements
Design Philosophy

Modern

Minimal

Professional

Mobile First

Inspired by modern analytics dashboards with clean cards, subtle shadows, rounded corners, and a blue accent color.

Mobile
Bottom navigation.
Large tap targets.
One-hand operation.
Simple attendance marking.
Minimal scrolling.
Responsive forms.
Desktop
Left collapsible sidebar.
Dashboard cards.
Charts and analytics.
Advanced tables with filters.
Bulk actions.
Accessibility
Large readable fonts.
High color contrast.
Icons with labels.
Clear success/error messages.
Confirmation dialogs before destructive actions.
20. Security

Role Based Access Control (RBAC)

MongoDB Validation

JWT Authentication

HTTPS

Input Validation

Output Encoding

XSS Protection

CSRF Protection

Rate Limiting

Password Hashing

Environment Variables

Encrypted Sensitive Data

Audit Logs

Session Expiry

Device Tracking

Account Lockout

Secure File Upload

Least Privilege Access

Daily Backups

21. Audit Logs

Record:

User

Action

Module

Previous Value

New Value

IP Address

Browser

Timestamp

Logs include:

Login

Logout

Attendance Create

Attendance Edit

Attendance Delete

Excel Upload

Excel Download

Settings Changes

Permission Changes

22. MongoDB Collections
users
roles
permissions
students
teachers
parents
classes
sections
attendance
attendance_history
notifications
announcements
holidays
academic_sessions
settings
audit_logs
file_uploads
device_sessions
23. Permission Matrix
Module	Super Admin	Admin	Office Staff	Teacher	Parent
Dashboard	✓	✓	✓	✓	✓
Students	CRUD	CRUD	Read	Read Assigned	Read Own
Teachers	CRUD	CRUD	Read	Read Self	No
Parents	CRUD	CRUD	Read	Read Assigned	Update Profile
Attendance	CRUD	CRUD	Read	Create/Edit (Timed)	Read
Reports	✓	✓	✓	Assigned	Own Child
Analytics	All	All	Basic	Class	Child
Notifications	✓	✓	View	View	View
Excel Import	✓	✓	No	No	No
Excel Export	✓	✓	Yes	Assigned	No
Settings	✓	Limited	No	No	No
Audit Logs	✓	View	No	No	No
24. Acceptance Criteria
Teachers can mark attendance for a class in under 3 minutes.
Attendance is locked after the configured edit window.
Parents receive WhatsApp notifications for absences.
All dashboards are fully responsive on mobile and desktop.
All screens support English and Hindi.
Admin can import/export data via Excel with validation.
Every critical action is logged in the audit trail.
System enforces RBAC and secure authentication.
MongoDB stores all operational data with appropriate indexing and validation.
UI remains intuitive for users with limited technical knowledge.
25. Future Enhancements
Face Recognition Attendance.
QR Code Attendance.
NFC Attendance.
Biometric Device Integration.
Student ID Card Generation.
Homework Module.
Fee Management.
Examination Management.
School Transport Tracking.
AI-powered absenteeism prediction.
Multi-school support (future SaaS version).
Final Notes

This PRD defines a mobile-first, bilingual, secure, and user-friendly web application tailored for J. R. Preparatory School. The solution emphasizes quick attendance capture, transparent communication with parents via WhatsApp, robust analytics for all user roles, comprehensive administrative control, and strong security practices using MongoDB and role-based access control. The interface should prioritize simplicity for non-technical users while providing powerful reporting and configuration capabilities for administrators.